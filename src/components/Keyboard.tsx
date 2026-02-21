import React from 'react';
import { COLEMAK_DH_SPLIT, COLEMAK_DH_SHIFTED, KEY_FINGER_MAP, FINGER_COLORS } from '../constants';
import { cn } from '../lib/utils';

interface KeyboardProps {
  activeKey?: string;
  isShiftPressed?: boolean;
}

export const Keyboard: React.FC<KeyboardProps> = ({ activeKey, isShiftPressed }) => {
  const renderHalf = (side: 'left' | 'right') => {
    const rows = isShiftPressed ? COLEMAK_DH_SHIFTED[side] : COLEMAK_DH_SPLIT[side];
    
    return (
      <div className="flex flex-col gap-1.5">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-1.5">
            {row.map((key) => {
              const isActive = activeKey?.toUpperCase() === key || activeKey === key;
              const isHomeRow = rowIndex === 1;
              const isHomingKey = isHomeRow && ['A', 'R', 'S', 'T', 'M', 'N', 'E', 'I'].includes(key);
              
              // Get finger color
              const finger = KEY_FINGER_MAP[key.toUpperCase()] || KEY_FINGER_MAP[key];
              const fingerColorClass = FINGER_COLORS[finger] || "";

              return (
                <div
                  key={key}
                  className={cn(
                    "key-cap w-11 h-11 text-base relative transition-colors duration-200",
                    !isActive && fingerColorClass,
                    isActive && "active",
                    isHomeRow && "home-row"
                  )}
                >
                  {key}
                  {isHomingKey && (
                    <div className="absolute bottom-1.5 w-4 h-0.5 rounded-full bg-current opacity-30" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col items-center gap-6 p-2 select-none">
      <div className="flex gap-12 items-start">
        {/* Left Half */}
        <div className="flex flex-col gap-4">
          {renderHalf('left')}
          {/* Left Thumbs */}
          <div className="flex gap-1.5 justify-end pr-2">
            <div className={cn("key-cap w-12 h-12 rounded-xl text-[10px]", FINGER_COLORS['thumb'], activeKey === 'Backspace' && "active")}>BSPC</div>
            <div className={cn("key-cap w-14 h-14 rounded-xl text-[10px]", FINGER_COLORS['thumb'], activeKey === 'Meta' && "active")}>CMD</div>
          </div>
        </div>

        {/* Right Half */}
        <div className="flex flex-col gap-4">
          {renderHalf('right')}
          {/* Right Thumbs */}
          <div className="flex gap-1.5 justify-start pl-2">
            <div className={cn("key-cap w-14 h-14 rounded-xl text-[10px]", FINGER_COLORS['thumb'], activeKey === 'Enter' && "active")}>RET</div>
            <div className={cn("key-cap w-12 h-12 rounded-xl text-[10px]", FINGER_COLORS['thumb'], activeKey === ' ' && "active")}>SPACE</div>
          </div>
        </div>
      </div>
    </div>
  );
};
