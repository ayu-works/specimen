import type { DesignScan, RawPage, RawSample } from '../schema';
import { area, bump, median, px, ranked, round } from './util';

export type Radii = DesignScan['radii'];

/** Largest corner radius in px (percentages resolve against the shorter side). */
export function radiusPx(s: RawSample): number | null {
  const v = s.s.borderRadius;
  if (!v || v === '0px') return null;
  const first = v.split(/[\s/]+/)[0] as string;
  if (first.endsWith('%')) {
    const pct = Number.parseFloat(first);
    return Number.isFinite(pct) ? (pct / 100) * Math.min(s.rect[2], s.rect[3]) : null;
  }
  return px(first);
}

const isCircle = (s: RawSample) =>
  (s.s.borderRadius ?? '').includes('%') && Math.abs(s.rect[2] - s.rect[3]) <= 2;

export function extractRadii(
  raw: RawPage,
  pageBg: string,
  bgOf: (i: number) => string | undefined,
): Radii {
  const hist = new Map<number, number>();
  const buttons: number[] = [];
  const buttonPill: boolean[] = [];
  const inputs: number[] = [];
  const cards: number[] = [];
  for (const s of raw.samples) {
    const r = radiusPx(s);
    if (r === null || r <= 0) continue;
    if (!isCircle(s))
      bump(hist, round(r, 1) >= 9999 ? 9999 : Math.round(r), Math.sqrt(Math.max(area(s), 1)));
    if (s.interactive === 'button') {
      buttons.push(r);
      buttonPill.push(r >= Math.min(s.rect[2], s.rect[3]) / 2 - 0.5);
    } else if (
      s.interactive === 'input' ||
      s.interactive === 'select' ||
      s.interactive === 'textarea'
    ) {
      inputs.push(r);
    } else if (s.rect[2] >= 160 && s.rect[3] >= 60 && !isCircle(s)) {
      const bg = bgOf(s.i);
      const decorated =
        (bg !== undefined && bg !== pageBg) ||
        !!s.s.boxShadow ||
        !!s.s.borderTopWidth ||
        !!s.s.borderBottomWidth;
      if (decorated) cards.push(r);
    }
  }
  const total = [...hist.values()].reduce((a, b) => a + b, 0) || 1;
  const scale = ranked(hist)
    .slice(0, 8)
    .map(([value, w]) => ({ value, weight: round(w / total, 4) }));
  const out: Radii = {
    scale,
    pillButtons:
      buttonPill.length > 0 && buttonPill.filter(Boolean).length / buttonPill.length >= 0.5,
  };
  const b = median(buttons);
  if (b !== null) out.button = b >= 9999 ? 9999 : Math.round(b);
  const c = median(cards);
  if (c !== null) out.card = Math.round(c);
  const i = median(inputs);
  if (i !== null) out.input = Math.round(i);
  return out;
}
