import { fromOklch, parseColor, type Rgba, toOklch } from './parse';

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** WCAG 2.x relative luminance (0–1). */
export function relativeLuminance(c: Rgba | string): number {
  const rgba = typeof c === 'string' ? parseColor(c) : c;
  if (!rgba) throw new Error(`Cannot compute luminance for: ${String(c)}`);
  return 0.2126 * lin(rgba.r) + 0.7152 * lin(rgba.g) + 0.0722 * lin(rgba.b);
}

/** WCAG 2.x contrast ratio, 1–21 (unrounded). */
export function contrast(a: Rgba | string, b: Rgba | string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Move `fg`'s OKLCH lightness (hue and chroma kept) until it reaches `min` contrast on `bg`.
 * Searches away from the background first, then the other way; returns the closest passing
 * lightness, or the best effort when nothing passes.
 */
export function ensureContrast(
  fg: string,
  bg: string,
  min: number,
): { hex: string; changed: boolean; ratio: number } {
  const start = contrast(fg, bg);
  if (start >= min) return { hex: fg, changed: false, ratio: start };
  const [l, c, h] = toOklch(fg);
  const bgDark = relativeLuminance(bg) < 0.18;
  const dirs = bgDark ? [1, -1] : [-1, 1];
  let best = { hex: fg, ratio: start };
  for (const dir of dirs) {
    for (let step = 1; step <= 200; step++) {
      const nl = l + dir * step * 0.005;
      if (nl < 0 || nl > 1) break;
      const hex = fromOklch(nl, c, h);
      const ratio = contrast(hex, bg);
      if (ratio > best.ratio) best = { hex, ratio };
      if (ratio >= min) return { hex, changed: true, ratio };
    }
  }
  return { hex: best.hex, changed: best.hex !== fg, ratio: best.ratio };
}
