/** Tiny color helpers for the sampler, using a 1×1 canvas so every CSS color syntax resolves. */

export type Rgba = [r: number, g: number, b: number, a: number];

let ctx: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      ctx = c.getContext('2d', { willReadFrequently: true });
    } catch {
      ctx = null;
    }
  }
  return ctx;
}

const cache = new Map<string, Rgba | null>();

/** sRGB bytes + alpha (0–1) of any CSS color, or null when it isn't a color. */
export function rgbaOf(css: string): Rgba | null {
  const key = css.trim();
  if (cache.has(key)) return cache.get(key) ?? null;
  let out: Rgba | null = null;
  const c = context();
  if (c && key) {
    // A sentinel value tells an unparseable string (ignored by the setter) from a real color.
    c.fillStyle = '#010203';
    c.fillStyle = key;
    const set = c.fillStyle;
    if (set !== '#010203' || /^#010203$/i.test(key)) {
      c.clearRect(0, 0, 1, 1);
      c.fillRect(0, 0, 1, 1);
      const d = c.getImageData(0, 0, 1, 1).data;
      out = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, Math.round(((d[3] ?? 0) / 255) * 100) / 100];
    }
  }
  cache.set(key, out);
  return out;
}

export function hexOf([r, g, b, a]: Rgba): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  const base = `#${h(r)}${h(g)}${h(b)}`;
  return a >= 1 ? base : `${base}${h(Math.round(a * 255))}`;
}

/** 0–1: how colorful (max channel − min channel). */
export function saturation([r, g, b]: Rgba): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

export function distance(a: Rgba, b: Rgba): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Alpha-composite `fg` over the opaque `bg`. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
    1,
  ];
}
