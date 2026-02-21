import React, { useMemo } from 'react';
import { KeyboardLayout, buildFingerMap } from '../layouts';
import { FINGER_COLORS } from '../constants';
import { cn } from '../lib/utils';

interface KeyboardProps {
  layout: KeyboardLayout;
  activeKey?: string;
  isShiftPressed?: boolean;
  compact?: boolean;
}

export const Keyboard: React.FC<KeyboardProps> = ({ layout, activeKey, isShiftPressed, compact }) => {
  const fingerMap = useMemo(() => buildFingerMap(layout), [layout]);

  const renderHalf = (side: 'left' | 'right') => {
    const rows = isShiftPressed
      ? (side === 'left' ? layout.shiftedLeft : layout.shiftedRight)
      : layout[side];
    const keySize = compact ? 'w-7 h-7 text-xs' : 'w-11 h-11 text-base';
    const gap = compact ? 'gap-1' : 'gap-1.5';

    return (
      <div className={cn('flex flex-col', gap)}>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className={cn('flex', gap)}>
            {row.map((key, colIndex) => {
              const isActive = activeKey?.toUpperCase() === key || activeKey === key;
              const isHomeRow = rowIndex === 1;
              // Homing bump on columns 0-3 of the home row (skip outermost col 4)
              const isHomingKey = isHomeRow && colIndex <= 3;

              const finger = fingerMap[key.toUpperCase()] || fingerMap[key];
              const fingerColorClass = FINGER_COLORS[finger] || '';

              return (
                <div
                  key={`${colIndex}-${key}`}
                  className={cn(
                    'key-cap relative',
                    keySize,
                    !isActive && fingerColorClass,
                    isActive && 'active',
                    isHomeRow && 'home-row',
                  )}
                >
                  {key}
                  {isHomingKey && (
                    <div
                      className={cn(
                        'absolute rounded-full bg-current opacity-30',
                        compact ? 'bottom-1 w-3 h-0.5' : 'bottom-1.5 w-4 h-0.5',
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  const thumbKey = compact
    ? 'key-cap w-8 h-8 rounded-lg text-sm'
    : 'key-cap w-12 h-12 rounded-xl text-base';
  const thumbKeyWide = compact
    ? 'key-cap w-10 h-10 rounded-lg text-sm'
    : 'key-cap w-14 h-14 rounded-xl text-base';

  return (
    <div className={cn('flex flex-col items-center select-none', compact ? 'gap-3 p-1' : 'gap-6 p-2')}>
      <div className={cn('flex items-start', compact ? 'gap-6' : 'gap-12')}>
        {/* Left Half */}
        <div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-4')}>
          {renderHalf('left')}
          <div className={cn('flex justify-end', compact ? 'gap-1 pr-1' : 'gap-1.5 pr-2')}>
            <div className={cn(thumbKey, FINGER_COLORS['thumb'], activeKey === 'Backspace' && 'active')}>⌫</div>
            <div className={cn(thumbKeyWide, FINGER_COLORS['thumb'], activeKey === 'Meta' && 'active')}>⌘</div>
          </div>
        </div>

        {/* Right Half */}
        <div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-4')}>
          {renderHalf('right')}
          <div className={cn('flex justify-start', compact ? 'gap-1 pl-1' : 'gap-1.5 pl-2')}>
            <div className={cn(thumbKeyWide, FINGER_COLORS['thumb'], activeKey === 'Enter' && 'active')}>⏎</div>
            <div className={cn(thumbKey, FINGER_COLORS['thumb'], activeKey === ' ' && 'active')}>␣</div>
          </div>
        </div>
      </div>
    </div>
  );
};
