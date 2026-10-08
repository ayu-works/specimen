import { parseColor, type Rgba } from './parse';

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
