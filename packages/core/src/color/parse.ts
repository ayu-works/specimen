import { clampChroma, converter, formatHex, parse } from 'culori';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

const toRgb = converter('rgb');
const toOklchConv = converter('oklch');

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Parse any CSS color into sRGB 0–1 channels + alpha, or null if unparseable. */
export function parseColor(css: string): Rgba | null {
  if (typeof css !== 'string') return null;
  const parsed = parse(css.trim());
  if (!parsed) return null;
  const rgb = toRgb(parsed);
  if (!rgb) return null;
  return {
    r: clamp01(rgb.r),
    g: clamp01(rgb.g),
    b: clamp01(rgb.b),
    alpha: clamp01(rgb.alpha ?? 1),
  };
}

/** `#rrggbb` (alpha ignored) or `#rrggbbaa` when alpha < 1. */
export function toHex(c: Rgba | string): string {
  const rgba = typeof c === 'string' ? parseColor(c) : c;
  if (!rgba) throw new Error(`Cannot convert to hex: ${String(c)}`);
  const hex = formatHex({ mode: 'rgb', r: rgba.r, g: rgba.g, b: rgba.b });
  if (rgba.alpha >= 1) return hex;
  const a = Math.round(rgba.alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** [lightness 0–1, chroma, hue 0–360]; hue is 0 for achromatic colors. */
export function toOklch(c: Rgba | string): [number, number, number] {
  const rgba = typeof c === 'string' ? parseColor(c) : c;
  if (!rgba) throw new Error(`Cannot convert to oklch: ${String(c)}`);
  const o = toOklchConv({ mode: 'rgb', r: rgba.r, g: rgba.g, b: rgba.b });
  return [o.l, o.c, o.h ?? 0];
}

/** OKLCH -> `#rrggbb`, reducing chroma to fit sRGB (hue and lightness are kept). */
export function fromOklch(l: number, c: number, h: number): string {
  const L = Math.min(1, Math.max(0, l));
  const color = clampChroma({ mode: 'oklch', l: L, c: Math.max(0, c), h }, 'oklch');
  return formatHex(color);
}
