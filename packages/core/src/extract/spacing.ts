import type { DesignScan, RawPage, RawSample } from '../schema';
import { area, bump, median, px, ranked } from './util';

export type Spacing = DesignScan['spacing'];

/** Preferred systems, largest first: picked when they explain ≥ 70% of spacing values. */
const PREFERRED = [8, 4];
/** Fallback candidates when no preferred unit explains enough values. */
const FALLBACK = [6, 5, 4, 2];
const MIN_SHARE = 0.7;
const isContent = (s: RawSample) =>
  Boolean(s.text || s.heading || s.interactive) ||
  ['img', 'svg', 'video', 'picture', 'canvas'].includes(s.tag);
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
      // Only real content counts: full-bleed backgrounds/wrappers would hide the band.
      const inner = (bySection.get(sec.index) ?? []).filter(
        (s) =>
          s !== root && s.s.position !== 'fixed' && s.s.position !== 'absolute' && isContent(s),
      );
      if (inner.length > 0) {
        const top = Math.max(0, Math.min(...inner.map((s) => s.rect[1])) - sec.rect[1]);
        const bottom = Math.max(
          0,
          sec.rect[1] + sec.rect[3] - Math.max(...inner.map((s) => s.rect[1] + s.rect[3])),
        );
        pad = top > 0 && bottom > 0 ? (top + bottom) / 2 : Math.max(top, bottom);
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
      if (v === null || v < 2 || v > 400) continue;
      bump(hist, Math.round(v * 2) / 2, w);
      if (k === 'rowGap' || k === 'columnGap') gaps.push(v);
    }
  }
  const total = [...hist.values()].reduce((a, b) => a + b, 0);

  // A value fits unit c only if it is (within 0.5px) an exact multiple. A ±1px tolerance
  // made c=2 match every integer, so real sites always came out as a 2px system.
  const share = (c: number) => {
    if (total === 0) return 0;
    let fit = 0;
    for (const [v, w] of hist) if (off(v, c) <= 0.5) fit += w;
    return fit / total;
  };
  let baseUnit = PREFERRED.find((c) => share(c) >= MIN_SHARE);
  if (baseUnit === undefined) {
    baseUnit = 4;
    let best = -1;
    for (const c of FALLBACK) {
      const sc = share(c) + (c === 4 ? 0.05 : 0);
      if (sc > best) {
        best = sc;
        baseUnit = c;
      }
    }
  }

  const peaks = ranked(hist)
    .slice(0, 10)
    .map(([v]) => {
      const snapped = Math.round(v / baseUnit) * baseUnit;
      return snapped > 0 && Math.abs(snapped - v) <= 0.5 ? snapped : v;
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
