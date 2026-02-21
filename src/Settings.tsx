import { useState, useEffect } from 'react';
import { emit } from '@tauri-apps/api/event';
import {
  THUMB_KEY_OPTIONS,
  DEFAULT_THUMBS,
  THUMBS_STORAGE_KEY,
  type ThumbConfig,
} from './thumbKeys';

export default function Settings() {
  const [thumbs, setThumbs] = useState<ThumbConfig>(() => {
    try {
      const saved = localStorage.getItem(THUMBS_STORAGE_KEY);
      if (saved) return JSON.parse(saved) as ThumbConfig;
    } catch { /* use default */ }
    return DEFAULT_THUMBS;
  });

  const update = (side: 'left' | 'right', index: 0 | 1, value: string) => {
    setThumbs((prev) => {
      const next = { ...prev, [side]: [...prev[side]] as [string, string] };
      next[side][index] = value;
      return next;
    });
  };

  // Persist and notify main window on any change
  useEffect(() => {
    localStorage.setItem(THUMBS_STORAGE_KEY, JSON.stringify(thumbs));
    emit('settings-update-thumbs', thumbs);
  }, [thumbs]);

  const selectClass =
    'w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Thumb Keys</h1>
          <p className="text-sm text-gray-500 mt-1">
            Customize the thumb keys shown in matrix mode.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Left side */}
          <div className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Left Hand
            </h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Inner thumb
              </label>
              <select
                value={thumbs.left[0]}
                onChange={(e) => update('left', 0, e.target.value)}
                className={selectClass}
              >
                {THUMB_KEY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Outer thumb
              </label>
              <select
                value={thumbs.left[1]}
                onChange={(e) => update('left', 1, e.target.value)}
                className={selectClass}
              >
                {THUMB_KEY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Right side */}
          <div className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Right Hand
            </h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Inner thumb
              </label>
              <select
                value={thumbs.right[0]}
                onChange={(e) => update('right', 0, e.target.value)}
                className={selectClass}
              >
                {THUMB_KEY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Outer thumb
              </label>
              <select
                value={thumbs.right[1]}
                onChange={(e) => update('right', 1, e.target.value)}
                className={selectClass}
              >
                {THUMB_KEY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setThumbs(DEFAULT_THUMBS);
          }}
          className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
