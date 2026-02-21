import { useState, useEffect } from 'react';
import { emit } from '@tauri-apps/api/event';
import {
  THUMB_KEY_OPTIONS,
  DEFAULT_THUMBS,
  THUMBS_STORAGE_KEY,
  THUMB_DISPLAY,
  type ThumbConfig,
} from './thumbKeys';

function ThumbSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 group">
      <span className="text-[13px] text-macos-label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="macos-select"
      >
        {THUMB_KEY_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

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

  useEffect(() => {
    localStorage.setItem(THUMBS_STORAGE_KEY, JSON.stringify(thumbs));
    emit('settings-update-thumbs', thumbs);
  }, [thumbs]);

  const isDefault =
    thumbs.left[0] === DEFAULT_THUMBS.left[0] &&
    thumbs.left[1] === DEFAULT_THUMBS.left[1] &&
    thumbs.right[0] === DEFAULT_THUMBS.right[0] &&
    thumbs.right[1] === DEFAULT_THUMBS.right[1];

  // Preview of current thumb layout
  const previewKey = (id: string) => (
    <div className="macos-preview-key">{THUMB_DISPLAY[id] ?? id}</div>
  );

  return (
    <div className="macos-settings-root">
      {/* Toolbar-style drag region */}
      <div data-tauri-drag-region className="macos-toolbar">
        <span className="macos-toolbar-title">Thumb Keys</span>
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* Preview */}
        <div className="flex items-center justify-center gap-8 pt-1 pb-2">
          <div className="flex gap-1.5">
            {previewKey(thumbs.left[0])}
            {previewKey(thumbs.left[1])}
          </div>
          <div className="text-[10px] font-medium text-macos-secondary tracking-widest uppercase">
            split
          </div>
          <div className="flex gap-1.5">
            {previewKey(thumbs.right[0])}
            {previewKey(thumbs.right[1])}
          </div>
        </div>

        {/* Left Hand */}
        <fieldset className="macos-fieldset">
          <legend className="macos-legend">Left Hand</legend>
          <div className="macos-field-group">
            <ThumbSelect
              label="Inner"
              value={thumbs.left[0]}
              onChange={(v) => update('left', 0, v)}
            />
            <div className="macos-separator" />
            <ThumbSelect
              label="Outer"
              value={thumbs.left[1]}
              onChange={(v) => update('left', 1, v)}
            />
          </div>
        </fieldset>

        {/* Right Hand */}
        <fieldset className="macos-fieldset">
          <legend className="macos-legend">Right Hand</legend>
          <div className="macos-field-group">
            <ThumbSelect
              label="Inner"
              value={thumbs.right[0]}
              onChange={(v) => update('right', 0, v)}
            />
            <div className="macos-separator" />
            <ThumbSelect
              label="Outer"
              value={thumbs.right[1]}
              onChange={(v) => update('right', 1, v)}
            />
          </div>
        </fieldset>

        {/* Reset */}
        <div className="flex justify-end pt-1">
          <button
            onClick={() => setThumbs(DEFAULT_THUMBS)}
            disabled={isDefault}
            className="macos-button-secondary"
          >
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
}
