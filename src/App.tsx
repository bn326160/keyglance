import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Keyboard } from "./components/Keyboard";
import { motion } from "framer-motion";
import { Minimize2, Maximize2 } from "lucide-react";

const SIZES = {
  normal: { width: 650, height: 350 },
  compact: { width: 440, height: 220 },
};

const IDLE_TIMEOUT = 2000;

const STORAGE_KEY = 'keyglance-compact';

// Only these 30 layout keys should make the keyboard fully visible
const LAYOUT_KEYS = new Set([
  'Q','W','F','P','B','J','L','U','Y',';',
  'A','R','S','T','G','M','N','E','I','O',
  'Z','X','C','D','V','K','H',',','.','/'
]);

export default function App() {
  const [activeKey, setActiveKey] = useState<string | undefined>();
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [compact, setCompact] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const resetIdleTimer = () => {
    setIdle(false);
    idleRef.current = false;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setIdle(true);
      idleRef.current = true;
    }, IDLE_TIMEOUT);
  };

  // Start idle timer on mount so keyboard goes transparent after 2s
  useEffect(() => {
    idleTimer.current = setTimeout(() => {
      setIdle(true);
      idleRef.current = true;
    }, IDLE_TIMEOUT);
    return () => clearTimeout(idleTimer.current);
  }, []);

  // Restore window size on mount if compact was saved
  useEffect(() => {
    if (compact) {
      import("@tauri-apps/api/dpi").then(({ LogicalSize }) => {
        getCurrentWindow().setSize(new LogicalSize(SIZES.compact.width, SIZES.compact.height));
      });
    }
  }, []);

  // Track focused text input and move window above it
  const compactRef = useRef(compact);
  compactRef.current = compact;

  useEffect(() => {
    const unlistenInput = listen<{ x: number; y: number; width: number; height: number }>(
      "focused-input",
      async (event) => {
        const { x, y, width, height } = event.payload;
        const { LogicalPosition } = await import("@tauri-apps/api/dpi");
        const win = getCurrentWindow();
        const size = compactRef.current ? SIZES.compact : SIZES.normal;

        // Center the keyboard above the input field, with a gap
        const gap = 40;
        const newX = x + width / 2 - size.width / 2;

        // Place above the input, but if not enough room, go below it
        let newY = y - size.height - gap;
        if (newY < 25) {
          newY = y + height + gap;
        }

        await win.setPosition(new LogicalPosition(
          Math.max(0, Math.round(newX)),
          Math.max(0, Math.round(newY)),
        ));
      },
    );

    return () => {
      unlistenInput.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const isLayoutKey = (key: string) =>
      LAYOUT_KEYS.has(key.toUpperCase()) || LAYOUT_KEYS.has(key);

    const THUMB_KEYS = new Set(['Backspace', 'Meta', 'Enter', ' ']);

    const unlistenDown = listen("global-keydown", (event) => {
      const rawKey = event.payload as string;
      const key = rawKey.replace("Key", "");
      if (key.includes("Shift")) setIsShiftPressed(true);
      if (isLayoutKey(key)) {
        setActiveKey(key);
        resetIdleTimer();
      } else if (THUMB_KEYS.has(key) && !idleRef.current) {
        setActiveKey(key);
      }
    });

    const unlistenUp = listen("global-keyup", (event) => {
      const rawKey = event.payload as string;
      const key = rawKey.replace("Key", "");
      if (key === "Shift") {
        setIsShiftPressed(false);
      }
      if (isLayoutKey(key) || THUMB_KEYS.has(key)) {
        setActiveKey(undefined);
      }
    });

    return () => {
      unlistenDown.then((f) => f());
      unlistenUp.then((f) => f());
      clearTimeout(idleTimer.current);
    };
  }, []);

  const toggleCompact = async () => {
    const next = !compact;
    setCompact(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    const size = next ? SIZES.compact : SIZES.normal;
    const win = getCurrentWindow();
    await win.setSize(new (await import("@tauri-apps/api/dpi")).LogicalSize(size.width, size.height));
  };

  return (
    <main className="h-screen w-screen flex items-center justify-center bg-transparent">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`glass rounded-3xl relative ${
          idle ? "idle" : ""
        } ${
          compact ? "p-4" : "p-8"
        }`}
      >
        {/* Drag region — fills the top of the card for window dragging */}
        <div
          data-tauri-drag-region
          className="absolute inset-0 h-10 rounded-t-3xl cursor-grab active:cursor-grabbing"
        />

        {/* Size toggle */}
        <button
          onClick={toggleCompact}
          className="absolute top-2.5 right-3 p-1 rounded-md text-black/20 hover:text-black/50 hover:bg-black/5 transition-colors z-10"
          title={compact ? "Normal size" : "Compact size"}
        >
          {compact ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
        </button>

        <div
          data-tauri-drag-region
          className={`font-black uppercase tracking-[0.2em] text-black/20 text-center ${
            compact ? "text-[8px] mb-3" : "text-[10px] mb-6"
          }`}
        >
          Colemak-DH Matrix
        </div>
        <Keyboard activeKey={activeKey} isShiftPressed={isShiftPressed} compact={compact} />
      </motion.div>
    </main>
  );
}