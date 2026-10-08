import { parseColor, type Rgba } from './parse';

/** Alpha-composite `fg` over an (assumed opaque) background; result is opaque. */
export function composite(fg: Rgba | string, bg: Rgba | string): Rgba {
  const f = typeof fg === 'string' ? parseColor(fg) : fg;
  const b = typeof bg === 'string' ? parseColor(bg) : bg;
  if (!f || !b) throw new Error('composite: unparseable color');
  const a = f.alpha;
  return {
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
    alpha: 1,
  };
}
