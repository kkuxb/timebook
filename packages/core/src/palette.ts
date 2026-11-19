export type ColorKey =
  | 'blue'
  | 'violet'
  | 'teal'
  | 'rose'
  | 'amber'
  | 'sky'
  | 'green'
  | 'pink';

export interface PaletteEntry {
  key: ColorKey;
  label: string;
  color: string;
  tint: string;
  ink: string;
  line: string;
}

export const MODULE_PALETTE: Record<ColorKey, PaletteEntry> = {
  blue: {
    key: 'blue',
    label: '蓝',
    color: '#4F7BFF',
    tint: '#EDF1FF',
    ink: '#2D4FCC',
    line: '#C9D5FF',
  },
  violet: {
    key: 'violet',
    label: '紫',
    color: '#8B5CF6',
    tint: '#F2EDFF',
    ink: '#6236D6',
    line: '#DCCDFF',
  },
  teal: {
    key: 'teal',
    label: '青绿',
    color: '#14B8A6',
    tint: '#E6F7F4',
    ink: '#0B7F72',
    line: '#B5E9E1',
  },
  rose: {
    key: 'rose',
    label: '玫红',
    color: '#F43F5E',
    tint: '#FFEDF0',
    ink: '#C8203E',
    line: '#FFC9D2',
  },
  amber: {
    key: 'amber',
    label: '琥珀',
    color: '#F59E0B',
    tint: '#FEF5E2',
    ink: '#9A5800',
    line: '#FDE1A9',
  },
  sky: {
    key: 'sky',
    label: '天蓝',
    color: '#0EA5E9',
    tint: '#E5F5FD',
    ink: '#086A99',
    line: '#B4E3FA',
  },
  green: {
    key: 'green',
    label: '绿',
    color: '#22C55E',
    tint: '#E8F8EE',
    ink: '#15803D',
    line: '#BCECCB',
  },
  pink: {
    key: 'pink',
    label: '粉',
    color: '#EC4899',
    tint: '#FDEDF6',
    ink: '#B5186E',
    line: '#F9C4E1',
  },
};

export const COLOR_KEYS: ColorKey[] = [
  'blue',
  'violet',
  'teal',
  'rose',
  'amber',
  'sky',
  'green',
  'pink',
];

export const UNCLASSIFIED_STYLE = {
  color: '#B8BDC9',
  tint: '#F2F3F7',
  ink: '#4B5263',
  line: '#E1E4EC',
} as const;

export const DEFAULT_MODULE_SEEDS: Array<{ name: string; colorKey: ColorKey; sort: number }> = [
  { name: '工作', colorKey: 'blue', sort: 0 },
  { name: '学习', colorKey: 'violet', sort: 1 },
  { name: '游戏', colorKey: 'teal', sort: 2 },
  { name: '锻炼', colorKey: 'rose', sort: 3 },
];

export function getPaletteEntry(colorKey: string | null | undefined): PaletteEntry {
  if (colorKey && colorKey in MODULE_PALETTE) {
    return MODULE_PALETTE[colorKey as ColorKey];
  }
  return MODULE_PALETTE.blue;
}

/**
 * 将模块主色与白色按比例混合（0 表示原色，1 表示纯白），用于区分同模块下的多个事项。
 */
export function mixWithWhite(hex: string, ratio: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const clamped = Math.max(0, Math.min(1, ratio));
  const channels = [0, 2, 4].map((idx) => {
    const val = parseInt(clean.slice(idx, idx + 2), 16);
    const mixed = Math.round(val + (255 - val) * clamped);
    return mixed.toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`.toUpperCase();
}
