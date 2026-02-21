use std::ffi::c_void;
use std::sync::{mpsc, atomic::{AtomicBool, Ordering}};
use std::thread;
use std::fs;
use std::path::PathBuf;
use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder, CheckMenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use serde::Serialize;

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().expect("no app config dir");
    let _ = fs::create_dir_all(&dir);
    dir.join("settings.json")
}

fn load_follow_input(app: &tauri::AppHandle) -> bool {
    let path = config_path(app);
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("follow_input")?.as_bool())
        .unwrap_or(false)
}

fn save_follow_input(app: &tauri::AppHandle, value: bool) {
    let path = config_path(app);
    let json = serde_json::json!({ "follow_input": value });
    let _ = fs::write(path, json.to_string());
}

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

// Payload for the focused-input position event
#[derive(Clone, Serialize)]
struct InputPosition {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

// --- Accessibility FFI for detecting focused text inputs --------------------

type AXUIElementRef = *const c_void;
type CFStringRef = *const c_void;
type CFTypeRef = *const c_void;
type AXError = i32;

const K_AX_ERROR_SUCCESS: AXError = 0;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementIsAttributeSettable(
        element: AXUIElementRef,
        attribute: CFStringRef,
        settable: *mut bool,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    fn AXValueGetValue(value: CFTypeRef, value_type: u32, value_ptr: *mut c_void) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(
        alloc: CFAllocatorRef,
        c_str: *const u8,
        encoding: u32,
    ) -> CFStringRef;
    fn CFRelease(cf: CFTypeRef);
    fn CFStringGetCString(
        the_string: CFStringRef,
        buffer: *mut u8,
        buffer_size: i64,
        encoding: u32,
    ) -> bool;
    fn CFGetTypeID(cf: CFTypeRef) -> u64;
    fn CFStringGetTypeID() -> u64;
    fn CFArrayGetCount(array: CFTypeRef) -> i64;
    fn CFArrayGetValueAtIndex(array: CFTypeRef, idx: i64) -> CFTypeRef;
    static kCFBooleanTrue: CFTypeRef;
}

#[link(name = "AppKit", kind = "framework")]
extern "C" {}

// NSWorkspace FFI via objc runtime
#[link(name = "objc", kind = "dylib")]
extern "C" {
    fn objc_getClass(name: *const u8) -> *mut c_void;
    fn objc_msgSend(receiver: *mut c_void, sel: *const c_void, ...) -> *mut c_void;
    fn sel_registerName(name: *const u8) -> *const c_void;
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;
// AXValueType constants
const K_AX_VALUE_CG_POINT: u32 = 1;
const K_AX_VALUE_CG_SIZE: u32 = 2;

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct CGSize {
    width: f64,
    height: f64,
}

/// Create a CFStringRef from a Rust string literal (null-terminated).
unsafe fn cf_str(s: &[u8]) -> CFStringRef {
    CFStringCreateWithCString(std::ptr::null(), s.as_ptr(), K_CF_STRING_ENCODING_UTF8)
}

/// Read the contents of a CFStringRef into a Rust String.
unsafe fn cfstring_to_string(cf: CFStringRef) -> Option<String> {
    if cf.is_null() || CFGetTypeID(cf) != CFStringGetTypeID() {
        return None;
    }
    let mut buf = [0u8; 256];
    if CFStringGetCString(cf, buf.as_mut_ptr(), buf.len() as i64, K_CF_STRING_ENCODING_UTF8) {
        let s = std::ffi::CStr::from_ptr(buf.as_ptr() as *const i8);
        Some(s.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// Read an AX attribute that returns a CFString.
unsafe fn ax_string_attr(el: AXUIElementRef, attr_name: &[u8]) -> Option<String> {
    let attr = cf_str(attr_name);
    let mut val: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(el, attr, &mut val);
    CFRelease(attr);
    if err != K_AX_ERROR_SUCCESS || val.is_null() {
        return None;
    }
    let result = cfstring_to_string(val);
    CFRelease(val);
    result
}

/// Debug: log the role and subrole of an AX element.
unsafe fn debug_element(label: &str, el: AXUIElementRef) {
    let role = ax_string_attr(el, b"AXRole\0").unwrap_or_default();
    let subrole = ax_string_attr(el, b"AXSubrole\0").unwrap_or_default();
    let desc = ax_string_attr(el, b"AXRoleDescription\0").unwrap_or_default();
    eprintln!("keyglance [{}]: role={} subrole={} desc={}", label, role, subrole, desc);
}

/// Get the PID of the frontmost application via NSWorkspace.
unsafe fn frontmost_app_pid() -> Option<i32> {
    let cls = objc_getClass(b"NSWorkspace\0".as_ptr());
    if cls.is_null() { return None; }
    let shared = objc_msgSend(cls, sel_registerName(b"sharedWorkspace\0".as_ptr()));
    if shared.is_null() { return None; }
    let app = objc_msgSend(shared, sel_registerName(b"frontmostApplication\0".as_ptr()));
    if app.is_null() { return None; }
    let pid = objc_msgSend(app, sel_registerName(b"processIdentifier\0".as_ptr())) as i32;
    if pid <= 0 { return None; }
    Some(pid)
}

/// Try to get the focused element from a specific app.
/// Falls back to system-wide if the app query fails.
unsafe fn get_focused_element() -> Option<CFTypeRef> {
    // Try app-specific first (works better for browsers / Electron)
    if let Some(pid) = frontmost_app_pid() {
        let app_el = AXUIElementCreateApplication(pid);
        if !app_el.is_null() {
            // Enable enhanced/manual accessibility for Chromium/Electron apps.
            // Different Electron versions respond to different attributes.
            let enhanced = cf_str(b"AXEnhancedUserInterface\0");
            AXUIElementSetAttributeValue(app_el, enhanced, kCFBooleanTrue);
            CFRelease(enhanced);

            let manual = cf_str(b"AXManualAccessibility\0");
            AXUIElementSetAttributeValue(app_el, manual, kCFBooleanTrue);
            CFRelease(manual);

            let attr = cf_str(b"AXFocusedUIElement\0");
            let mut focused: CFTypeRef = std::ptr::null();
            let err = AXUIElementCopyAttributeValue(app_el, attr, &mut focused);
            CFRelease(attr);

            if err == K_AX_ERROR_SUCCESS && !focused.is_null() {
                CFRelease(app_el as CFTypeRef);
                return Some(focused);
            }

            // If app-level fails, try AXFocusedWindow → AXFocusedUIElement
            let attr_win = cf_str(b"AXFocusedWindow\0");
            let mut win: CFTypeRef = std::ptr::null();
            let err2 = AXUIElementCopyAttributeValue(app_el, attr_win, &mut win);
            CFRelease(attr_win);
            if err2 == K_AX_ERROR_SUCCESS && !win.is_null() {
                let attr2 = cf_str(b"AXFocusedUIElement\0");
                let mut focused2: CFTypeRef = std::ptr::null();
                let err3 = AXUIElementCopyAttributeValue(win as AXUIElementRef, attr2, &mut focused2);
                CFRelease(attr2);
                CFRelease(win);
                if err3 == K_AX_ERROR_SUCCESS && !focused2.is_null() {
                    CFRelease(app_el as CFTypeRef);
                    return Some(focused2);
                }
            }

            CFRelease(app_el as CFTypeRef);
        }
    }

    // Fallback: system-wide
    let system = AXUIElementCreateSystemWide();
    let attr = cf_str(b"AXFocusedUIElement\0");
    let mut focused: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(system, attr, &mut focused);
    CFRelease(attr);
    CFRelease(system as CFTypeRef);
    if err == K_AX_ERROR_SUCCESS && !focused.is_null() {
        Some(focused)
    } else {
        None
    }
}

/// Check if the element is an editable text input using multiple strategies.
unsafe fn is_text_input(el: AXUIElementRef) -> bool {
    let role = ax_string_attr(el, b"AXRole\0").unwrap_or_default();
    let subrole = ax_string_attr(el, b"AXSubrole\0").unwrap_or_default();

    // Reject terminals
    if subrole == "AXTerminalArea" || role == "AXTerminalArea" {
        return false;
    }

    // Accept known text input roles immediately
    match role.as_str() {
        "AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField" => return true,
        _ => {}
    }

    // Reject structural / non-editable roles (containers, chrome, etc.)
    match role.as_str() {
        "AXScrollArea" | "AXTable" | "AXList" | "AXOutline"
        | "AXSplitGroup" | "AXTabGroup" | "AXToolbar"
        | "AXMenuBar" | "AXMenu" | "AXMenuItem" | "AXWindow"
        | "AXApplication" | "AXImage" | "AXButton"
        | "AXRadioButton" | "AXCheckBox" | "AXSlider"
        | "AXProgressIndicator" | "AXBrowser" | "AXSplitter" => return false,
        _ => {}
    }

    // For unknown/web roles: check if AXValue is settable
    let attr_value = cf_str(b"AXValue\0");
    let mut settable = false;
    let err = AXUIElementIsAttributeSettable(el, attr_value, &mut settable);
    CFRelease(attr_value);
    if err == K_AX_ERROR_SUCCESS && settable {
        return true;
    }

    // Check if AXSelectedText is readable (common in web text inputs)
    let attr_sel = cf_str(b"AXSelectedText\0");
    let mut val: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(el, attr_sel, &mut val);
    CFRelease(attr_sel);
    if err == K_AX_ERROR_SUCCESS {
        if !val.is_null() { CFRelease(val); }
        // Only accept if the role isn't a container
        if role != "AXGroup" && role != "AXWebArea" && role != "AXStaticText" {
            return true;
        }
    }

    false
}

/// Search AXChildren (up to max_depth) for a text input element with a rect.
unsafe fn find_text_input_in_children(
    el: AXUIElementRef,
    depth: u32,
    max_depth: u32,
) -> Option<(f64, f64, f64, f64)> {
    if depth >= max_depth {
        return None;
    }
    let attr_children = cf_str(b"AXChildren\0");
    let mut children_ref: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(el, attr_children, &mut children_ref);
    CFRelease(attr_children);
    if err != K_AX_ERROR_SUCCESS || children_ref.is_null() {
        return None;
    }
    let count = CFArrayGetCount(children_ref);
    // Limit to avoid runaway traversal
    let count = count.min(20);
    for i in 0..count {
        let child = CFArrayGetValueAtIndex(children_ref, i);
        if child.is_null() { continue; }
        if is_text_input(child as AXUIElementRef) {
            if let Some(rect) = get_element_rect(child as AXUIElementRef) {
                CFRelease(children_ref);
                return Some(rect);
            }
        }
        // Recurse one more level
        if let Some(rect) = find_text_input_in_children(child as AXUIElementRef, depth + 1, max_depth) {
            CFRelease(children_ref);
            return Some(rect);
        }
    }
    CFRelease(children_ref);
    None
}

/// Try to get the focused text input's screen rectangle.
/// Returns Some((x, y, w, h)) if a text field/area is focused.
unsafe fn get_focused_text_input_rect() -> Option<(f64, f64, f64, f64)> {
    let focused_el = get_focused_element()?;

    // 1. Check if the focused element itself is a text input
    if is_text_input(focused_el as AXUIElementRef) {
        if let Some(rect) = get_element_rect(focused_el as AXUIElementRef) {
            CFRelease(focused_el);
            return Some(rect);
        }
    }

    // 2. For Electron/Chrome apps (VS Code, Claude, etc.), the focused
    //    element may be a container (AXGroup/AXWebArea) with a text input
    //    child. Search children up to 3 levels deep.
    if let Some(rect) = find_text_input_in_children(focused_el as AXUIElementRef, 0, 3) {
        CFRelease(focused_el);
        return Some(rect);
    }

    CFRelease(focused_el);
    None
}

/// Extract position and size from an AX element.
unsafe fn get_element_rect(el: AXUIElementRef) -> Option<(f64, f64, f64, f64)> {
    // Get the position
    let attr_pos = cf_str(b"AXPosition\0");
    let mut pos_ref: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(el, attr_pos, &mut pos_ref);
    CFRelease(attr_pos);

    if err != K_AX_ERROR_SUCCESS || pos_ref.is_null() {
        return None;
    }

    let mut point = CGPoint::default();
    AXValueGetValue(pos_ref, K_AX_VALUE_CG_POINT, &mut point as *mut _ as *mut c_void);
    CFRelease(pos_ref);

    // Get the size
    let attr_size = cf_str(b"AXSize\0");
    let mut size_ref: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(el, attr_size, &mut size_ref);
    CFRelease(attr_size);

    if err != K_AX_ERROR_SUCCESS || size_ref.is_null() {
        return None;
    }

    let mut size = CGSize::default();
    AXValueGetValue(size_ref, K_AX_VALUE_CG_SIZE, &mut size as *mut _ as *mut c_void);
    CFRelease(size_ref);

    Some((point.x, point.y, size.width, size.height))
}

// Global toggle for follow-input behavior
static FOLLOW_INPUT: AtomicBool = AtomicBool::new(false);

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Load persisted setting
            let saved = load_follow_input(app.handle());
            FOLLOW_INPUT.store(saved, Ordering::Relaxed);

            // --- System tray with menu ---
            let follow_item = CheckMenuItemBuilder::new("Follow Text Input")
                .id("follow-input")
                .checked(saved)
                .build(app)?;

            let quit_item = MenuItemBuilder::new("Quit")
                .id("quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&follow_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_handle = app.handle().clone();
            let tray_icon_bytes = include_bytes!("../icons/tray-icon.png");
            let tray_icon = tauri::image::Image::from_bytes(tray_icon_bytes)?;
            TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(move |_app, event| {
                    match event.id().as_ref() {
                        "follow-input" => {
                            let current = FOLLOW_INPUT.load(Ordering::Relaxed);
                            FOLLOW_INPUT.store(!current, Ordering::Relaxed);
                            save_follow_input(&tray_handle, !current);
                            let _ = tray_handle.emit("tray-follow-input", !current);
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

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

            // Focused text input tracker – polls AX API and emits position.
            let ax_handle = app.handle().clone();
            thread::spawn(move || {
                let mut last_pos: Option<(f64, f64, f64, f64)> = None;
                let mut last_pid: Option<i32> = None;
                loop {
                    // Debug: log focused element info when the frontmost app changes
                    unsafe {
                        let pid = frontmost_app_pid();
                        if pid != last_pid {
                            last_pid = pid;
                            if let Some(el) = get_focused_element() {
                                debug_element("app-switch", el as AXUIElementRef);
                                let is_input = is_text_input(el as AXUIElementRef);
                                eprintln!("keyglance: pid={:?} is_text_input={}", pid, is_input);
                                CFRelease(el);
                            } else {
                                eprintln!("keyglance: pid={:?} no focused element", pid);
                            }
                        }
                    }

                    let current = if FOLLOW_INPUT.load(Ordering::Relaxed) {
                        unsafe { get_focused_text_input_rect() }
                    } else {
                        None
                    };
                    if current != last_pos {
                        match &current {
                            Some((x, y, w, h)) => {
                                let _ = ax_handle.emit(
                                    "focused-input",
                                    InputPosition { x: *x, y: *y, width: *w, height: *h },
                                );
                            }
                            None => {
                                let _ = ax_handle.emit("focused-input-lost", "");
                            }
                        }
                        last_pos = current;
                    }
                    thread::sleep(std::time::Duration::from_millis(300));
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