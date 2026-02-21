import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Keyboard } from "./components/Keyboard";
import { motion } from "framer-motion";
import { Minimize2, Maximize2 } from "lucide-react";

const SIZES = {
  normal: { width: 650, height: 350 },
  compact: { width: 440, height: 220 },
};

export default function App() {
  const [activeKey, setActiveKey] = useState<string | undefined>();
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const unlistenDown = listen("global-keydown", (event) => {
      const rawKey = event.payload as string;
      const key = rawKey.replace("Key", "");
      setActiveKey(key);
      if (key.includes("Shift")) setIsShiftPressed(true);
    });

    const unlistenUp = listen("global-keyup", (event) => {
      const rawKey = event.payload as string;
      const key = rawKey.replace("Key", "");
      if (key === "Shift") {
        setIsShiftPressed(false);
      }
      setActiveKey(undefined);
    });

    return () => {
      unlistenDown.then((f) => f());
      unlistenUp.then((f) => f());
    };
  }, []);

  const toggleCompact = async () => {
    const next = !compact;
    setCompact(next);
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