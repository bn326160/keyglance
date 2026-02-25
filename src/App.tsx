import { useState, useEffect, useRef, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Keyboard } from "./components/Keyboard";
import { motion } from "framer-motion";
import { Minimize2, Maximize2 } from "lucide-react";
import { LAYOUTS, getLayoutKeys, type LayoutId, type KeyboardLayout } from "./layouts";
import { DEFAULT_THUMBS, THUMBS_STORAGE_KEY, NUMBERS_STORAGE_KEY, type ThumbConfig } from "./thumbKeys";

function getWindowSize(compact: boolean, matrix: boolean, showNumbers: boolean) {
  const numExtra = showNumbers ? (compact ? 35 : 50) : 0;
  if (compact && matrix) return { width: 440, height: 220 + numExtra };
  if (compact && !matrix) return { width: 380, height: 160 + numExtra };
  if (!compact && matrix) return { width: 650, height: 350 + numExtra };
  return { width: 560, height: 240 + numExtra };
}

const IDLE_TIMEOUT = 2000;

const STORAGE_KEY = 'keyglance-compact';
const LAYOUT_STORAGE_KEY = 'keyglance-layout';
const MATRIX_STORAGE_KEY = 'keyglance-matrix';

export default function App() {
  const [activeKey, setActiveKey] = useState<string | undefined>();
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [compact, setCompact] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');
  const [layoutId, setLayoutId] = useState<LayoutId>(() => {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return (saved && saved in LAYOUTS) ? saved as LayoutId : 'colemak-dh';
  });
  const [matrix, setMatrix] = useState(() => {
    const saved = localStorage.getItem(MATRIX_STORAGE_KEY);
    return saved === null ? true : saved === 'true';
  });
  const [showNumbers, setShowNumbers] = useState(() => {
    return localStorage.getItem(NUMBERS_STORAGE_KEY) === 'true';
  });
  const [thumbKeys, setThumbKeys] = useState<ThumbConfig>(() => {
    try {
      const saved = localStorage.getItem(THUMBS_STORAGE_KEY);
      if (saved) return JSON.parse(saved) as ThumbConfig;
    } catch { /* use default */ }
    return DEFAULT_THUMBS;
  });
  const [idle, setIdle] = useState(false);
  const [accessibilityMissing, setAccessibilityMissing] = useState(false);
  const idleRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const layout: KeyboardLayout = LAYOUTS[layoutId];
  const layoutKeys = useMemo(() => getLayoutKeys(layout, showNumbers), [layout, showNumbers]);

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

  // Restore window size on mount
  useEffect(() => {
    const size = getWindowSize(compact, matrix, showNumbers);
    import("@tauri-apps/api/dpi").then(({ LogicalSize }) => {
      getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
    });
  }, []);

  // Track focused text input and move window above it
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const matrixRef = useRef(matrix);
  matrixRef.current = matrix;
  const showNumbersRef = useRef(showNumbers);
  showNumbersRef.current = showNumbers;

  useEffect(() => {
    const unlistenInput = listen<{ x: number; y: number; width: number; height: number }>(
      "focused-input",
      async (event) => {
        const { x, y, width, height } = event.payload;
        const { LogicalPosition } = await import("@tauri-apps/api/dpi");
        const win = getCurrentWindow();
        const size = getWindowSize(compactRef.current, matrixRef.current, showNumbersRef.current);

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

  const thumbKeySet = useMemo(
    () => new Set([...thumbKeys.left, ...thumbKeys.right]),
    [thumbKeys],
  );

  useEffect(() => {
    const isLayoutKey = (key: string) =>
      layoutKeys.has(key.toUpperCase()) || layoutKeys.has(key);

    const unlistenDown = listen("global-keydown", (event) => {
      const rawKey = event.payload as string;
      const key = rawKey.replace("Key", "");
      if (key.includes("Shift")) setIsShiftPressed(true);
      if (isLayoutKey(key)) {
        setActiveKey(key);
        resetIdleTimer();
      } else if (thumbKeySet.has(key) && !idleRef.current) {
        setActiveKey(key);
      }
    });

    const unlistenUp = listen("global-keyup", (event) => {
      const rawKey = event.payload as string;
      const key = rawKey.replace("Key", "");
      if (key === "Shift") {
        setIsShiftPressed(false);
      }
      if (isLayoutKey(key) || thumbKeySet.has(key)) {
        setActiveKey(undefined);
      }
    });

    return () => {
      unlistenDown.then((f) => f());
      unlistenUp.then((f) => f());
      clearTimeout(idleTimer.current);
    };
  }, [layoutKeys, thumbKeySet]);

  // Listen for tray menu events (layout change, matrix toggle, numbers toggle)
  useEffect(() => {
    const unlistenLayout = listen<string>("tray-change-layout", (event) => {
      const id = event.payload as LayoutId;
      if (id in LAYOUTS) {
        setLayoutId(id);
        localStorage.setItem(LAYOUT_STORAGE_KEY, id);
      }
    });

    const unlistenMatrix = listen<boolean>("tray-toggle-matrix", async (event) => {
      const newVal = event.payload;
      setMatrix(newVal);
      localStorage.setItem(MATRIX_STORAGE_KEY, String(newVal));
      const size = getWindowSize(compactRef.current, newVal, showNumbersRef.current);
      const win = getCurrentWindow();
      await win.setSize(new (await import("@tauri-apps/api/dpi")).LogicalSize(size.width, size.height));
    });

    const unlistenNumbers = listen<boolean>("tray-toggle-numbers", async (event) => {
      const newVal = event.payload;
      setShowNumbers(newVal);
      localStorage.setItem(NUMBERS_STORAGE_KEY, String(newVal));
      const size = getWindowSize(compactRef.current, matrixRef.current, newVal);
      const win = getCurrentWindow();
      await win.setSize(new (await import("@tauri-apps/api/dpi")).LogicalSize(size.width, size.height));
    });

    const unlistenThumbs = listen<ThumbConfig>("settings-update-thumbs", (event) => {
      const config = event.payload;
      setThumbKeys(config);
      localStorage.setItem(THUMBS_STORAGE_KEY, JSON.stringify(config));
    });

    const unlistenAccessMissing = listen("accessibility-missing", () => {
      setAccessibilityMissing(true);
    });

    const unlistenAccessGranted = listen("accessibility-granted", () => {
      setAccessibilityMissing(false);
    });

    return () => {
      unlistenLayout.then((f) => f());
      unlistenMatrix.then((f) => f());
      unlistenNumbers.then((f) => f());
      unlistenThumbs.then((f) => f());
      unlistenAccessMissing.then((f) => f());
      unlistenAccessGranted.then((f) => f());
    };
  }, []);

  const toggleCompact = async () => {
    const next = !compact;
    setCompact(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    const size = getWindowSize(next, matrix, showNumbers);
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
          {layout.name}
        </div>

        <Keyboard layout={layout} activeKey={activeKey} isShiftPressed={isShiftPressed} compact={compact} matrix={matrix} showNumbers={showNumbers} thumbKeys={thumbKeys} />

        {accessibilityMissing && (
          <div className={`text-center text-red-500/70 font-semibold ${compact ? "text-[8px] mt-2" : "text-[10px] mt-3"}`}>
            Enable Keyglance in System Settings &gt; Privacy &amp; Security &gt; Accessibility
          </div>
        )}
      </motion.div>
    </main>
  );
}