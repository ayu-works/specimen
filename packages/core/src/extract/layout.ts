import type { DesignScan, RawPage } from '../schema';
import { area, bump, median, px, ranked } from './util';

export type LayoutBase = Omit<DesignScan['layout'], 'blueprint' | 'density'>;

export function extractBreakpoints(media: string[]): number[] {
  const counts = new Map<number, number>();
  for (const q of media) {
    for (const m of q.matchAll(/(min|max)-width:\s*(-?\d*\.?\d+)(px|em|rem)/gi)) {
      let v = Number(m[2]);
      if ((m[3] as string).toLowerCase() !== 'px') v *= 16;
      v = Math.round(v);
      if (v >= 240 && v <= 2560) bump(counts, v, 1);
    }
  }
  return ranked(counts)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 5)
    .map(([v]) => v)
    .sort((a, b) => a - b);
}

export function extractLayout(raw: RawPage): LayoutBase {
  const vw = raw.viewport.w;
  const strong = new Map<number, number>();
  const weak = new Map<number, { w: number; n: number }>();
  const padOf = new Map<number, number[]>();
  for (const s of raw.samples) {
    const [x, , w] = s.rect;
    if (s.depth < 1 || w < 320 || w >= vw - 8) continue;
    if (Math.abs(x - (vw - x - w)) >= 4) continue;
    const mw = px(s.s.maxWidth);
    if (mw !== null) {
      const key = Math.round(w / 8) * 8;
      bump(strong, key, area(s));
      padOf.set(key, [...(padOf.get(key) ?? []), px(s.s.paddingLeft) ?? 0]);
    } else if (w >= vw * 0.4 && w <= vw * 0.92) {
      const key = Math.round(w / 8) * 8;
      const e = weak.get(key) ?? { w: 0, n: 0 };
      e.w += area(s);
      e.n++;
      weak.set(key, e);
    }
  }
  let container: number | null = ranked(strong)[0]?.[0] ?? null;
  if (container === null) {
    const best = [...weak].filter(([, e]) => e.n >= 3).sort((a, b) => b[1].w - a[1].w)[0];
    container = best ? best[0] : null;
  }
  const pads = container !== null ? (padOf.get(container) ?? []) : [];
  const gutter = pads.length > 0 ? (median(pads) ?? null) : null;
  return {
    containerMaxWidth: container,
    gutter: gutter && gutter > 0 ? gutter : null,
    breakpoints: extractBreakpoints(raw.mediaQueries),
  };
}

export function densityOf(
  sectionPaddingY: number,
  baseSize: number,
): DesignScan['layout']['density'] {
  const r = sectionPaddingY / (baseSize || 16);
  return r < 4 ? 'compact' : r < 7 ? 'comfortable' : 'airy';
}
