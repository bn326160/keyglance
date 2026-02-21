export type LayoutId = 'qwerty' | 'azerty' | 'qwertz' | 'dvorak' | 'colemak' | 'colemak-dh';

export interface KeyboardLayout {
  id: LayoutId;
  name: string;
  left: string[][];
  right: string[][];
  shiftedLeft: string[][];
  shiftedRight: string[][];
}

// Finger assignment based on column position (same for all split layouts)
const LEFT_FINGERS = ['left-pinky', 'left-ring', 'left-middle', 'left-index', 'left-index'];
const RIGHT_FINGERS = ['right-index', 'right-index', 'right-middle', 'right-ring', 'right-pinky'];

// Number row data (shared across all layouts — always QWERTY positional)
export const NUMBER_ROW_LEFT = ['1', '2', '3', '4', '5'];
export const NUMBER_ROW_RIGHT = ['6', '7', '8', '9', '0'];
export const NUMBER_ROW_SHIFTED_LEFT = ['!', '@', '#', '$', '%'];
export const NUMBER_ROW_SHIFTED_RIGHT = ['^', '&', '*', '(', ')'];

/**
 * Build a key→finger mapping from a layout's key positions.
 */
export function buildFingerMap(layout: KeyboardLayout, includeNumbers = false): Record<string, string> {
  const map: Record<string, string> = {};
  for (const side of ['left', 'right'] as const) {
    const rows = layout[side];
    const fingers = side === 'left' ? LEFT_FINGERS : RIGHT_FINGERS;
    for (const row of rows) {
      for (let col = 0; col < row.length; col++) {
        const key = row[col];
        map[key] = fingers[col];
        map[key.toUpperCase()] = fingers[col];
      }
    }
  }
  if (includeNumbers) {
    for (let col = 0; col < NUMBER_ROW_LEFT.length; col++) {
      map[NUMBER_ROW_LEFT[col]] = LEFT_FINGERS[col];
      map[NUMBER_ROW_SHIFTED_LEFT[col]] = LEFT_FINGERS[col];
    }
    for (let col = 0; col < NUMBER_ROW_RIGHT.length; col++) {
      map[NUMBER_ROW_RIGHT[col]] = RIGHT_FINGERS[col];
      map[NUMBER_ROW_SHIFTED_RIGHT[col]] = RIGHT_FINGERS[col];
    }
  }
  return map;
}

/**
 * Get all unique keys present in a layout (for checking if a key event
 * should activate the keyboard overlay).
 */
export function getLayoutKeys(layout: KeyboardLayout, includeNumbers = false): Set<string> {
  const keys = new Set<string>();
  for (const side of ['left', 'right'] as const) {
    for (const row of layout[side]) {
      for (const key of row) {
        keys.add(key);
        keys.add(key.toUpperCase());
      }
    }
  }
  if (includeNumbers) {
    for (const key of NUMBER_ROW_LEFT) keys.add(key);
    for (const key of NUMBER_ROW_RIGHT) keys.add(key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Layout definitions
// ---------------------------------------------------------------------------

export const LAYOUTS: Record<LayoutId, KeyboardLayout> = {
  'qwerty': {
    id: 'qwerty',
    name: 'QWERTY',
    left: [
      ['Q', 'W', 'E', 'R', 'T'],
      ['A', 'S', 'D', 'F', 'G'],
      ['Z', 'X', 'C', 'V', 'B'],
    ],
    right: [
      ['Y', 'U', 'I', 'O', 'P'],
      ['H', 'J', 'K', 'L', ';'],
      ['N', 'M', ',', '.', '/'],
    ],
    shiftedLeft: [
      ['Q', 'W', 'E', 'R', 'T'],
      ['A', 'S', 'D', 'F', 'G'],
      ['Z', 'X', 'C', 'V', 'B'],
    ],
    shiftedRight: [
      ['Y', 'U', 'I', 'O', 'P'],
      ['H', 'J', 'K', 'L', ':'],
      ['N', 'M', '<', '>', '?'],
    ],
  },

  'azerty': {
    id: 'azerty',
    name: 'AZERTY',
    left: [
      ['A', 'Z', 'E', 'R', 'T'],
      ['Q', 'S', 'D', 'F', 'G'],
      ['W', 'X', 'C', 'V', 'B'],
    ],
    right: [
      ['Y', 'U', 'I', 'O', 'P'],
      ['H', 'J', 'K', 'L', 'M'],
      ['N', ',', ';', ':', '!'],
    ],
    shiftedLeft: [
      ['A', 'Z', 'E', 'R', 'T'],
      ['Q', 'S', 'D', 'F', 'G'],
      ['W', 'X', 'C', 'V', 'B'],
    ],
    shiftedRight: [
      ['Y', 'U', 'I', 'O', 'P'],
      ['H', 'J', 'K', 'L', 'M'],
      ['N', '?', '.', '/', '\u00A7'],
    ],
  },

  'qwertz': {
    id: 'qwertz',
    name: 'QWERTZ',
    left: [
      ['Q', 'W', 'E', 'R', 'T'],
      ['A', 'S', 'D', 'F', 'G'],
      ['Y', 'X', 'C', 'V', 'B'],
    ],
    right: [
      ['Z', 'U', 'I', 'O', 'P'],
      ['H', 'J', 'K', 'L', ';'],
      ['N', 'M', ',', '.', '/'],
    ],
    shiftedLeft: [
      ['Q', 'W', 'E', 'R', 'T'],
      ['A', 'S', 'D', 'F', 'G'],
      ['Y', 'X', 'C', 'V', 'B'],
    ],
    shiftedRight: [
      ['Z', 'U', 'I', 'O', 'P'],
      ['H', 'J', 'K', 'L', ':'],
      ['N', 'M', '<', '>', '?'],
    ],
  },

  'dvorak': {
    id: 'dvorak',
    name: 'Dvorak',
    left: [
      ["'", ',', '.', 'P', 'Y'],
      ['A', 'O', 'E', 'U', 'I'],
      [';', 'Q', 'J', 'K', 'X'],
    ],
    right: [
      ['F', 'G', 'C', 'R', 'L'],
      ['D', 'H', 'T', 'N', 'S'],
      ['B', 'M', 'W', 'V', 'Z'],
    ],
    shiftedLeft: [
      ['"', '<', '>', 'P', 'Y'],
      ['A', 'O', 'E', 'U', 'I'],
      [':', 'Q', 'J', 'K', 'X'],
    ],
    shiftedRight: [
      ['F', 'G', 'C', 'R', 'L'],
      ['D', 'H', 'T', 'N', 'S'],
      ['B', 'M', 'W', 'V', 'Z'],
    ],
  },

  'colemak': {
    id: 'colemak',
    name: 'Colemak',
    left: [
      ['Q', 'W', 'F', 'P', 'G'],
      ['A', 'R', 'S', 'T', 'D'],
      ['Z', 'X', 'C', 'V', 'B'],
    ],
    right: [
      ['J', 'L', 'U', 'Y', ';'],
      ['H', 'N', 'E', 'I', 'O'],
      ['K', 'M', ',', '.', '/'],
    ],
    shiftedLeft: [
      ['Q', 'W', 'F', 'P', 'G'],
      ['A', 'R', 'S', 'T', 'D'],
      ['Z', 'X', 'C', 'V', 'B'],
    ],
    shiftedRight: [
      ['J', 'L', 'U', 'Y', ':'],
      ['H', 'N', 'E', 'I', 'O'],
      ['K', 'M', '<', '>', '?'],
    ],
  },

  'colemak-dh': {
    id: 'colemak-dh',
    name: 'Colemak-DH',
    left: [
      ['Q', 'W', 'F', 'P', 'B'],
      ['A', 'R', 'S', 'T', 'G'],
      ['Z', 'X', 'C', 'D', 'V'],
    ],
    right: [
      ['J', 'L', 'U', 'Y', ';'],
      ['M', 'N', 'E', 'I', 'O'],
      ['K', 'H', ',', '.', '/'],
    ],
    shiftedLeft: [
      ['Q', 'W', 'F', 'P', 'B'],
      ['A', 'R', 'S', 'T', 'G'],
      ['Z', 'X', 'C', 'D', 'V'],
    ],
    shiftedRight: [
      ['J', 'L', 'U', 'Y', ':'],
      ['M', 'N', 'E', 'I', 'O'],
      ['K', 'H', '<', '>', '?'],
    ],
  },
};
