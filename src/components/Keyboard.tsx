import React, { useMemo } from 'react';
import {
  KeyboardLayout,
  buildFingerMap,
  NUMBER_ROW_LEFT,
  NUMBER_ROW_RIGHT,
  NUMBER_ROW_SHIFTED_LEFT,
  NUMBER_ROW_SHIFTED_RIGHT,
} from '../layouts';
import { FINGER_COLORS } from '../constants';
import { THUMB_DISPLAY, type ThumbConfig } from '../thumbKeys';
import { cn } from '../lib/utils';

interface KeyboardProps {
  layout: KeyboardLayout;
  activeKey?: string;
  isShiftPressed?: boolean;
  compact?: boolean;
  matrix?: boolean;
  showNumbers?: boolean;
  thumbKeys?: ThumbConfig;
}

export const Keyboard: React.FC<KeyboardProps> = ({
  layout,
  activeKey,
  isShiftPressed,
  compact,
  matrix = true,
  showNumbers = false,
  thumbKeys,
}) => {
  const fingerMap = useMemo(() => buildFingerMap(layout, showNumbers), [layout, showNumbers]);

  const keySize = compact ? 'w-7 h-7 text-xs' : 'w-11 h-11 text-base';
  const gap = compact ? 'gap-1' : 'gap-1.5';

  // Home row index shifts when number row is shown
  const homeRowIndex = showNumbers ? 2 : 1;

  const renderKey = (key: string, rowIndex: number, colIndex: number, side: 'left' | 'right') => {
    const isActive = activeKey?.toUpperCase() === key || activeKey === key;
    const isHomeRow = rowIndex === homeRowIndex;
    // Homing bump: left cols 0-3, right cols 1-4
    const isHomingKey = isHomeRow && (side === 'left' ? colIndex <= 3 : colIndex >= 1);

    const finger = fingerMap[key.toUpperCase()] || fingerMap[key];
    const fingerColorClass = FINGER_COLORS[finger] || '';

    return (
      <div
        key={`${side}-${rowIndex}-${colIndex}-${key}`}
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
  };

  const getRows = (side: 'left' | 'right') => {
    const alphaRows = isShiftPressed
      ? (side === 'left' ? layout.shiftedLeft : layout.shiftedRight)
      : layout[side];
    if (!showNumbers) return alphaRows;
    // Prepend number row
    const numRow = isShiftPressed
      ? (side === 'left' ? NUMBER_ROW_SHIFTED_LEFT : NUMBER_ROW_SHIFTED_RIGHT)
      : (side === 'left' ? NUMBER_ROW_LEFT : NUMBER_ROW_RIGHT);
    return [numRow, ...alphaRows];
  };

  // --- Flat (non-matrix) layout: single block, no split gap, no thumb keys ---
  if (!matrix) {
    const leftRows = getRows('left');
    const rightRows = getRows('right');

    return (
      <div className={cn('flex flex-col items-center select-none', gap, compact ? 'p-1' : 'p-2')}>
        {leftRows.map((leftRow, rowIndex) => {
          const rightRow = rightRows[rowIndex];
          return (
            <div key={rowIndex} className={cn('flex', gap)}>
              {leftRow.map((key, ci) => renderKey(key, rowIndex, ci, 'left'))}
              {rightRow.map((key, ci) => renderKey(key, rowIndex, ci, 'right'))}
            </div>
          );
        })}
      </div>
    );
  }

  // --- Matrix (split) layout: two halves with gap + thumb keys ---
  const renderHalf = (side: 'left' | 'right') => {
    const rows = getRows(side);
    return (
      <div className={cn('flex flex-col', gap)}>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className={cn('flex', gap)}>
            {row.map((key, ci) => renderKey(key, rowIndex, ci, side))}
          </div>
        ))}
      </div>
    );
  };

  const thumbKeyClass = compact
    ? 'key-cap w-8 h-8 rounded-lg text-sm'
    : 'key-cap w-12 h-12 rounded-xl text-base';
  const thumbKeyWide = compact
    ? 'key-cap w-10 h-10 rounded-lg text-sm'
    : 'key-cap w-14 h-14 rounded-xl text-base';

  const renderThumb = (keyId: string, wide: boolean) => (
    <div
      key={keyId}
      className={cn(
        wide ? thumbKeyWide : thumbKeyClass,
        FINGER_COLORS['thumb'],
        activeKey === keyId && 'active',
      )}
    >
      {THUMB_DISPLAY[keyId] ?? keyId}
    </div>
  );

  const leftThumbs = thumbKeys?.left ?? ['Backspace', 'Meta'];
  const rightThumbs = thumbKeys?.right ?? ['Enter', ' '];

  return (
    <div className={cn('flex flex-col items-center select-none', compact ? 'gap-3 p-1' : 'gap-6 p-2')}>
      <div className={cn('flex items-start', compact ? 'gap-6' : 'gap-12')}>
        {/* Left Half */}
        <div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-4')}>
          {renderHalf('left')}
          <div className={cn('flex justify-end', compact ? 'gap-1 pr-1' : 'gap-1.5 pr-2')}>
            {renderThumb(leftThumbs[0], false)}
            {renderThumb(leftThumbs[1], true)}
          </div>
        </div>

        {/* Right Half */}
        <div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-4')}>
          {renderHalf('right')}
          <div className={cn('flex justify-start', compact ? 'gap-1 pl-1' : 'gap-1.5 pl-2')}>
            {renderThumb(rightThumbs[0], true)}
            {renderThumb(rightThumbs[1], false)}
          </div>
        </div>
      </div>
    </div>
  );
};
