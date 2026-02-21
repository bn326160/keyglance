import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Keyboard } from "./components/Keyboard";
import { motion } from "framer-motion";

export default function App() {
  const [activeKey, setActiveKey] = useState<string | undefined>();
  const [isShiftPressed, setIsShiftPressed] = useState(false);

  useEffect(() => {
    const unlistenDown = listen("global-keydown", (event) => {
      const rawKey = event.payload as string;
      // Clean up the key name from Rust (e.g., "KeyA" -> "A")
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

  return (
    <main className="h-screen w-screen flex items-center justify-center bg-transparent">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-3xl p-8 shadow-2xl border-white/20"
      >
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-black/20 mb-6 text-center">
          Colemak-DH Matrix
        </div>
        <Keyboard activeKey={activeKey} isShiftPressed={isShiftPressed} />
      </motion.div>
    </main>
  );
}