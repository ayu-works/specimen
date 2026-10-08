import type { DesignScan, RawPage, RawSample } from '../schema';
import { area, bump, median, px, ranked } from './util';

export type Spacing = DesignScan['spacing'];

const CANDIDATES = [2, 4, 5, 6, 8, 10, 12];
const KEYS = [
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginBottom',
  'rowGap',
  'columnGap',
] as const;

/** Distance from `v` to the nearest multiple of `c`. */
const off = (v: number, c: number) => {
  const r = v % c;
  return Math.min(r, c - r);
};

function sectionPadding(raw: RawPage): number {
  const bySection = new Map<number, RawSample[]>();
  for (const s of raw.samples) {
    const list = bySection.get(s.section) ?? [];
    list.push(s);
    bySection.set(s.section, list);
  }
  const pads: { pad: number; nav: boolean; footer: boolean }[] = [];
  for (const sec of raw.sections) {
    const root = raw.samples.find(
      (s) =>
        s.rect[0] === sec.rect[0] &&
        s.rect[1] === sec.rect[1] &&
        s.rect[2] === sec.rect[2] &&
        s.rect[3] === sec.rect[3] &&
        s.section === sec.index,
    );
    let pad = 0;
    if (root) pad = ((px(root.s.paddingTop) ?? 0) + (px(root.s.paddingBottom) ?? 0)) / 2;
    if (pad <= 0) {
      // Padding lives on an inner wrapper: use the empty band above/below the content.
      const inner = (bySection.get(sec.index) ?? []).filter(
        (s) => s !== root && s.s.position !== 'fixed' && s.s.position !== 'absolute',
      );
      if (inner.length > 0) {
        const top = Math.min(...inner.map((s) => s.rect[1]));
        const bottom = Math.max(...inner.map((s) => s.rect[1] + s.rect[3]));
        pad = Math.max(0, Math.min(top - sec.rect[1], sec.rect[1] + sec.rect[3] - bottom));
      }
    }
    pads.push({
      pad,
      nav:
        sec.landmark === 'header' ||
        sec.landmark === 'nav' ||
        (sec.index === 0 && sec.rect[3] < 140),
      footer: sec.landmark === 'footer',
    });
  }
  const body = pads.filter((p) => !p.nav && !p.footer && p.pad > 0).map((p) => p.pad);
  const all = pads.filter((p) => p.pad > 0).map((p) => p.pad);
  return Math.round(median(body.length >= 1 ? body : all) ?? 0);
}

export function extractSpacing(raw: RawPage): Spacing {
  const hist = new Map<number, number>();
  const gaps: number[] = [];
  for (const s of raw.samples) {
    const w = Math.sqrt(Math.max(area(s), 1));
    for (const k of KEYS) {
      const v = px(s.s[k]);
      if (v === null || v < 1 || v > 400) continue;
      bump(hist, Math.round(v), w);
      if (k === 'rowGap' || k === 'columnGap') gaps.push(v);
    }
  }
  const total = [...hist.values()].reduce((a, b) => a + b, 0);

  let baseUnit = 8;
  let bestScore = Number.NEGATIVE_INFINITY;
  if (total > 0) {
    for (const c of CANDIDATES) {
      let fit = 0;
      for (const [v, w] of hist) if (off(v, c) <= 1) fit += w;
      const score = fit / total - 0.02 * (12 / c);
      // Ties prefer 4 or 8.
      const better =
        score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && (c === 4 || c === 8));
      if (better) {
        bestScore = score;
        baseUnit = c;
      }
    }
  }

  const peaks = ranked(hist)
    .slice(0, 10)
    .map(([v]) => {
      const snapped = Math.round(v / baseUnit) * baseUnit;
      return snapped > 0 && Math.abs(snapped - v) <= 1 ? snapped : v;
    });
  const scale = [...new Set(peaks)].sort((a, b) => a - b);

  const contentGap = Math.round(median(gaps) ?? baseUnit * 3);
  return {
    baseUnit,
    scale,
    sectionPaddingY: sectionPadding(raw),
    contentGap,
  };
}
