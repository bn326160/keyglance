use std::ffi::c_void;
use std::sync::mpsc;
use std::thread;
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Lightweight macOS CGEventTap key listener
//
// We avoid `rdev` because its internal `raw_callback` calls TSM APIs
// (TISCopyCurrentKeyboardInputSource / TSMGetInputSourceProperty) from a
// background thread.  On modern macOS these APIs assert the main dispatch
// queue and crash with `_dispatch_assert_queue_fail`.
//
// Instead we set up a CGEventTap ourselves and only read the virtual key
// code from each event – no TSM / keyboard-layout calls at all.
// ---------------------------------------------------------------------------

// --- C / Core Graphics FFI -------------------------------------------------

type CGEventTapProxy = *const c_void;
type CFMachPortRef = *const c_void;
type CFRunLoopSourceRef = *const c_void;
type CFRunLoopRef = *const c_void;
type CFRunLoopMode = *const c_void;
type CFAllocatorRef = *const c_void;

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(dead_code)]
enum CGEventType {
    Null = 0,
    LeftMouseDown = 1,
    LeftMouseUp = 2,
    RightMouseDown = 3,
    RightMouseUp = 4,
    MouseMoved = 5,
    LeftMouseDragged = 6,
    RightMouseDragged = 7,
    KeyDown = 10,
    KeyUp = 11,
    FlagsChanged = 12,
    ScrollWheel = 22,
    TapDisabledByTimeout = 0xFFFFFFFE_u32,
    TapDisabledByUserInput = 0xFFFFFFFF_u32,
}

// Opaque CGEvent pointer (we only read fields, never dereference in Rust)
type CGEventRef = *const c_void;

type CGEventTapCallback = unsafe extern "C" fn(
    proxy: CGEventTapProxy,
    event_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,             // CGEventTapLocation (kCGHIDEventTap = 0)
        place: u32,           // CGEventTapPlacement (kCGHeadInsertEventTap = 0)
        options: u32,         // CGEventTapOptions (kCGEventTapOptionListenOnly = 1)
        events_of_interest: u64,
        callback: CGEventTapCallback,
        user_info: *mut c_void,
    ) -> CFMachPortRef;

    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventGetFlags(event: CGEventRef) -> u64;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFMachPortCreateRunLoopSource(
        allocator: CFAllocatorRef,
        port: CFMachPortRef,
        order: i64,
    ) -> CFRunLoopSourceRef;
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFRunLoopMode);
    fn CFRunLoopRun();
    static kCFRunLoopCommonModes: CFRunLoopMode;
}

// CGEvent field index for the virtual key code
const KEYBOARD_EVENT_KEYCODE: u32 = 9;

// CGEventMask bits for the events we care about
const EVENT_MASK: u64 = (1 << CGEventType::KeyDown as u64)
    | (1 << CGEventType::KeyUp as u64)
    | (1 << CGEventType::FlagsChanged as u64);

// --- keycode → name ---------------------------------------------------------

/// Map a macOS virtual key code to a human-readable name.
/// These are positional (QWERTY-based) hardware codes – they don't depend on
/// the active keyboard layout, so no TSM calls are needed.
fn keycode_to_name(code: u16) -> String {
    match code {
        // Letters (QWERTY positions)
        0  => "A",  1  => "S",  2  => "D",  3  => "F",  5  => "G",
        4  => "H", 38  => "J", 40  => "K", 37  => "L",
        12 => "Q", 13 => "W", 14 => "E", 15 => "R", 17 => "T",
        16 => "Y", 32 => "U", 34 => "I", 31 => "O", 35 => "P",
        6  => "Z",  7  => "X",  8  => "C",  9  => "V", 11 => "B",
        45 => "N", 46 => "M",
        // Digits
        18 => "1", 19 => "2", 20 => "3", 21 => "4", 23 => "5",
        22 => "6", 26 => "7", 28 => "8", 25 => "9", 29 => "0",
        // Punctuation / symbols
        43 => ",", 47 => ".", 44 => "/", 41 => ";", 39 => "'",
        33 => "[", 30 => "]", 42 => "\\", 50 => "`", 27 => "-", 24 => "=",
        // Whitespace / editing
        49 => " ", 36 => "Enter", 51 => "Backspace", 48 => "Tab", 53 => "Escape",
        // Modifiers
        55 | 54 => "Meta",
        56 | 60 => "Shift",
        59 | 62 => "Control",
        58 | 61 => "Alt",
        57 => "CapsLock",
        63 => "Fn",
        // Arrow keys
        126 => "ArrowUp", 125 => "ArrowDown", 123 => "ArrowLeft", 124 => "ArrowRight",
        // Navigation
        115 => "Home", 119 => "End", 116 => "PageUp", 121 => "PageDown",
        117 => "Delete",
        // Function keys
        122 => "F1", 120 => "F2",  99 => "F3", 118 => "F4",
        96  => "F5",  97 => "F6",  98 => "F7", 100 => "F8",
        101 => "F9", 109 => "F10", 103 => "F11", 111 => "F12",
        _ => return format!("Unknown({})", code),
    }
    .to_string()
}

// --- modifier state tracking for FlagsChanged events ------------------------

/// On macOS, modifier keys emit FlagsChanged instead of KeyDown/KeyUp.
/// We track the previous flags to determine press vs release.
static mut LAST_FLAGS: u64 = 0;

fn is_modifier(code: u16) -> bool {
    matches!(code, 54 | 55 | 56 | 57 | 58 | 59 | 60 | 61 | 62 | 63)
}

// --- CGEventTap callback (runs on the listener thread's run loop) -----------

enum KeyEvent {
    Press(String),
    Release(String),
}

// We pass a raw pointer to the channel sender as user_info.
unsafe extern "C" fn tap_callback(
    _proxy: CGEventTapProxy,
    event_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef {
    let tx = &*(user_info as *const mpsc::Sender<KeyEvent>);

    let etype: CGEventType = std::mem::transmute(event_type);
    match etype {
        CGEventType::KeyDown => {
            let code = CGEventGetIntegerValueField(event, KEYBOARD_EVENT_KEYCODE) as u16;
            let _ = tx.send(KeyEvent::Press(keycode_to_name(code)));
        }
        CGEventType::KeyUp => {
            let code = CGEventGetIntegerValueField(event, KEYBOARD_EVENT_KEYCODE) as u16;
            let _ = tx.send(KeyEvent::Release(keycode_to_name(code)));
        }
        CGEventType::FlagsChanged => {
            let code = CGEventGetIntegerValueField(event, KEYBOARD_EVENT_KEYCODE) as u16;
            if is_modifier(code) {
                // Read the current modifier flags via CGEventGetFlags
                let flags = CGEventGetFlags(event);
                if flags > LAST_FLAGS {
                    let _ = tx.send(KeyEvent::Press(keycode_to_name(code)));
                } else {
                    let _ = tx.send(KeyEvent::Release(keycode_to_name(code)));
                }
                LAST_FLAGS = flags;
            }
        }
        _ => {}
    }

    event // pass-through (listen-only tap)
}

// --- main -------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            let (tx, rx) = mpsc::channel::<KeyEvent>();

            // Emitter thread – receives key events and forwards to the webview.
            thread::spawn(move || {
                for event in rx {
                    match event {
                        KeyEvent::Press(key_str) => {
                            let _ = app_handle.emit("global-keydown", key_str);
                        }
                        KeyEvent::Release(key_str) => {
                            let _ = app_handle.emit("global-keyup", key_str);
                        }
                    }
                }
            });

            // Listener thread – sets up a CGEventTap on its own run loop.
            // Only reads the virtual key code (an integer); no TSM / keyboard
            // layout APIs are called, so it's safe on any thread.
            thread::spawn(move || unsafe {
                // Leak the sender so it lives as long as the thread.
                let tx_ptr = Box::into_raw(Box::new(tx));

                let tap = CGEventTapCreate(
                    0, // kCGHIDEventTap
                    0, // kCGHeadInsertEventTap
                    1, // kCGEventTapOptionListenOnly
                    EVENT_MASK,
                    tap_callback,
                    tx_ptr as *mut c_void,
                );
                if tap.is_null() {
                    eprintln!("keyglance: failed to create CGEventTap (Accessibility permissions?)");
                    return;
                }

                let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
                if source.is_null() {
                    eprintln!("keyglance: failed to create run loop source");
                    return;
                }

                let run_loop = CFRunLoopGetCurrent();
                CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
                CGEventTapEnable(tap, true);
                CFRunLoopRun(); // blocks forever
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}