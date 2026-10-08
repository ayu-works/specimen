import type { DesignScan, RawPage, TypeStyle } from '../schema';
import { bump, primaryFamily, px, ranked, round } from './util';

type Family = DesignScan['typography']['families'][number];
export type Typography = DesignScan['typography'];

interface Group {
  key: string;
  family: string;
  stack: string;
  size: number;
  weight: number;
  lineHeight: number;
  letterSpacingEm: number;
  transform?: TypeStyle['transform'];
  weightSum: number;
  /** Text length by element tag, for body-copy detection. */
  bodyCopy: number;
  tags: Set<string>;
  heading: Map<number, number>;
  buttonW: number;
  labelW: number;
  sample?: string;
}

const SYSTEM_FAMILIES = new Set([
  'system-ui',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'helvetica',
  'helvetica neue',
  'arial',
  'roboto',
  'georgia',
  'times new roman',
  'times',
  'sans-serif',
  'serif',
  'monospace',
  'ui-monospace',
  'ui-sans-serif',
  'ui-serif',
  'sf mono',
  'sfmono-regular',
  'menlo',
  'consolas',
  'courier new',
  'courier',
  'cursive',
  'fantasy',
]);
const MONO = /mono|courier|consolas|menlo/i;
const BODY_TAGS = new Set(['p', 'li', 'td', 'span', 'dd', 'div']);

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'font'
  );
}

/** Where a family comes from: @font-face src host, else a known system stack. */
function fontSource(name: string, raw: RawPage): Family['source'] {
  const lower = name.toLowerCase();
  let pageHost = '';
  try {
    pageHost = new URL(raw.url).host;
  } catch {
    /* not a URL */
  }
  for (const f of raw.fontFaces) {
    if (f.family.toLowerCase() !== lower) continue;
    const m = /url\(\s*["']?([^"')]+)/i.exec(f.src);
    if (!m) continue;
    const u = (m[1] as string).trim();
    if (u.startsWith('data:')) return 'self-hosted';
    let host: string;
    try {
      host = new URL(u, raw.url).host;
    } catch {
      return 'unknown';
    }
    if (/(^|\.)(fonts\.gstatic\.com|fonts\.googleapis\.com)$/.test(host)) return 'google';
    if (/(^|\.)(use\.typekit\.net|p\.typekit\.net)$/.test(host)) return 'adobe';
    if (host === pageHost || !/^(https?:)?\/\//.test(u)) return 'self-hosted';
    return 'unknown';
  }
  return SYSTEM_FAMILIES.has(lower) ? 'system' : 'unknown';
}

function buildGroups(raw: RawPage): Group[] {
  const groups = new Map<string, Group>();
  for (const smp of raw.samples) {
    const len = smp.text?.len ?? 0;
    const size = px(smp.s.fontSize);
    if (len <= 0 || size === null || !smp.s.fontFamily) continue;
    const weight = Number(smp.s.fontWeight ?? 400) || 400;
    const lhPx = px(smp.s.lineHeight);
    const lineHeight = lhPx !== null ? round(lhPx / size, 2) : 1.2;
    const lsPx = px(smp.s.letterSpacing);
    const letterSpacingEm = lsPx !== null ? round(lsPx / size, 3) : 0;
    const t = smp.s.textTransform;
    const transform = t === 'uppercase' || t === 'lowercase' || t === 'capitalize' ? t : undefined;
    const family = primaryFamily(smp.s.fontFamily);
    const sz = round(size, 2);
    const key = [family, sz, weight, lineHeight, letterSpacingEm, transform ?? ''].join('|');
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        family,
        stack: smp.s.fontFamily,
        size: sz,
        weight,
        lineHeight,
        letterSpacingEm,
        transform,
        weightSum: 0,
        bodyCopy: 0,
        tags: new Set(),
        heading: new Map(),
        buttonW: 0,
        labelW: 0,
      };
      groups.set(key, g);
    }
    g.weightSum += len;
    g.tags.add(smp.tag);
    if (smp.heading) bump(g.heading, smp.heading, len);
    if (!smp.heading && !smp.interactive && BODY_TAGS.has(smp.tag)) g.bodyCopy += len;
    if (smp.interactive === 'button') g.buttonW += len;
    if (
      smp.interactive === 'input' ||
      smp.interactive === 'select' ||
      smp.interactive === 'textarea' ||
      smp.tag === 'label' ||
      smp.tag === 'th' ||
      smp.tag === 'summary'
    ) {
      g.labelW += len;
    }
    if (!g.sample && smp.text?.snippet) g.sample = smp.text.snippet;
  }
  return [...groups.values()].sort((a, b) => b.weightSum - a.weightSum);
}

/** Body copy = heaviest group among p/li/td/span with long runs of text (len > 40). */
function bodyGroup(groups: Group[], raw: RawPage): Group | undefined {
  const keyOf = (smp: (typeof raw.samples)[number]) => {
    const size = px(smp.s.fontSize);
    return `${primaryFamily(smp.s.fontFamily ?? '')}|${round(size ?? 0, 2)}|${Number(smp.s.fontWeight ?? 400) || 400}`;
  };
  const byPrefix = new Map<string, Group[]>();
  for (const g of groups) {
    const k = `${g.family}|${g.size}|${g.weight}`;
    byPrefix.set(k, [...(byPrefix.get(k) ?? []), g]);
  }
  for (const minLen of [40, 15, 0]) {
    const weights = new Map<string, number>();
    for (const smp of raw.samples) {
      const len = smp.text?.len ?? 0;
      if (len <= minLen || smp.heading || smp.interactive || !BODY_TAGS.has(smp.tag)) continue;
      bump(weights, keyOf(smp), len);
    }
    let top = ranked(weights)[0];
    const bodyEl = raw.samples.find((x) => x.tag === 'body');
    if (top && bodyEl) {
      const bk = keyOf(bodyEl);
      const bg = (byPrefix.get(bk) ?? []).reduce((a, g) => a + g.bodyCopy, 0);
      if (bg >= top[1] * 0.1) top = [bk, bg];
    }
    if (top) {
      const cands = byPrefix.get(top[0]) ?? [];
      return cands.sort((a, b) => b.bodyCopy - a.bodyCopy)[0];
    }
  }
  return groups[0];
}

function toStyle(g: Group, role: TypeStyle['role'], familyId: string, total: number): TypeStyle {
  const s: TypeStyle = {
    id: role,
    role,
    familyId,
    size: g.size,
    weight: g.weight,
    lineHeight: g.lineHeight,
    letterSpacingEm: g.letterSpacingEm,
    weightShare: round(g.weightSum / (total || 1), 4),
  };
  if (g.transform) s.transform = g.transform;
  if (g.sample) s.sample = g.sample;
  return s;
}

/**
 * Fit a modular scale: the ratio r (1.1–1.8) for which every significant size at or above
 * the body size lies on body × r^k (±2.5%), with at least four distinct sizes matched.
 * Returns the geometric-mean step of the matched sizes, or null for irregular scales.
 */
export function fitScale(sizes: number[], body: number): number | null {
  const up = [...new Set(sizes.filter((s) => s >= body * 0.99))].sort((a, b) => a - b);
  if (up.length < 4) return null;
  let best: number | null = null;
  let bestErr = Number.POSITIVE_INFINITY;
  for (let r = 1.125; r <= 1.8; r += 0.0025) {
    let err = 0;
    let ok = true;
    for (const s of up) {
      const k = Math.round(Math.log(s / body) / Math.log(r));
      const rel = Math.abs(s - body * r ** k) / s;
      if (rel > 0.012) {
        ok = false;
        break;
      }
      err += rel;
    }
    if (ok && err < bestErr - 1e-9) {
      best = r;
      bestErr = err;
    }
  }
  if (best === null) return null;
  const ratio = (up[up.length - 1] as number) / (up[0] as number);
  const steps = Math.round(Math.log(ratio) / Math.log(best));
  return steps > 0 ? round(ratio ** (1 / steps), 2) : null;
}

export function extractTypography(raw: RawPage): Typography {
  const groups = buildGroups(raw);
  const total = groups.reduce((a, g) => a + g.weightSum, 0);
  const styles: TypeStyle[] = [];
  const used = new Set<string>();
  const families = new Map<string, Family>();

  const familyFor = (g: Group): string => {
    const id = `f-${slug(g.family)}`;
    let f = families.get(id);
    if (!f) {
      f = {
        id,
        name: g.family,
        stack: g.stack,
        role: 'body',
        source: fontSource(g.family, raw),
        weights: [],
      };
      families.set(id, f);
    }
    if (!f.weights.includes(g.weight)) f.weights.push(g.weight);
    return id;
  };
  const add = (g: Group | undefined, role: TypeStyle['role']) => {
    if (!g || used.has(g.key) || styles.some((s) => s.role === role)) return;
    used.add(g.key);
    styles.push(toStyle(g, role, familyFor(g), total));
  };

  const body = bodyGroup(groups, raw);
  const bodySize = body?.size ?? 16;
  add(body, 'body');

  // Headings: heaviest group per heading level; fall back to size rank.
  const ROLES = ['h1', 'h2', 'h3', 'h4'] as const;
  ROLES.forEach((role, i) => {
    const lvl = i + 1;
    add(
      groups
        .filter((g) => (g.heading.get(lvl) ?? 0) > 0 && !used.has(g.key))
        .sort((a, b) => (b.heading.get(lvl) ?? 0) - (a.heading.get(lvl) ?? 0))[0],
      role,
    );
  });
  if (!styles.some((s) => s.role === 'h1')) {
    const bigger = groups
      .filter((g) => !used.has(g.key) && g.size > bodySize * 1.2 && g.buttonW === 0)
      .sort((a, b) => b.size - a.size);
    ROLES.forEach((role, i) => {
      add(bigger[i], role);
    });
  }
  const h1 = styles.find((s) => s.role === 'h1');
  if (h1) {
    add(
      groups.find((g) => !used.has(g.key) && g.size > h1.size * 1.6 && g.buttonW === 0),
      'display',
    );
  }

  const rest = groups.filter((g) => !used.has(g.key));
  add(
    rest.find((g) => g.size > bodySize * 1.05 && g.heading.size === 0 && g.buttonW === 0),
    'body-lg',
  );
  const smalls = rest.filter((g) => g.size < bodySize && g.heading.size === 0 && g.buttonW === 0);
  const small = smalls.find((g) => g.size >= bodySize * 0.8) ?? smalls[0];
  add(small, 'small');
  add(
    smalls.find((g) => g !== small && g.size < (small?.size ?? bodySize)),
    'caption',
  );
  add(
    groups
      .filter((g) => g.buttonW > 0 && !used.has(g.key))
      .sort((a, b) => b.buttonW - a.buttonW)[0],
    'button',
  );
  add(
    groups.filter((g) => g.labelW > 0 && !used.has(g.key)).sort((a, b) => b.labelW - a.labelW)[0],
    'label',
  );
  add(
    groups.find((g) => !used.has(g.key) && MONO.test(g.stack)),
    'code',
  );

  // Family roles: headings → display, body → body, monospace → mono.
  const bodyFam = styles.find((s) => s.role === 'body')?.familyId;
  for (const s of styles) {
    const f = families.get(s.familyId);
    if (!f) continue;
    if (s.role === 'code') f.role = 'mono';
    else if (s.familyId !== bodyFam && /^(display|h[1-4])$/.test(s.role)) f.role = 'display';
  }

  const significant = groups.filter((g) => g.weightSum / (total || 1) >= 0.004).map((g) => g.size);
  const scaleSizes = [
    ...significant,
    ...styles.filter((s) => /^(display|h[1-4]|body-lg)$/.test(s.role)).map((s) => s.size),
  ];

  const order = [
    'display',
    'h1',
    'h2',
    'h3',
    'h4',
    'body-lg',
    'body',
    'small',
    'caption',
    'label',
    'button',
    'code',
  ];
  styles.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return {
    families: [...families.values()],
    styles,
    baseSize: bodySize,
    scaleRatio: fitScale(scaleSizes, bodySize),
  };
}
