import {
  type ColorEntry,
  clusterColors,
  composite,
  contrast,
  deltaE2000,
  parseColor,
  type Rgba,
  toHex,
} from '../color';
import type { ColorRole, ColorToken, DesignScan, RawPage } from '../schema';
import { area, bump, px, ranked } from './util';

/** Resolved (opaque, hex) colors of one sample. */
export interface SampleColors {
  /** The sample's own background, composited over its nearest opaque ancestor background. */
  ownBg?: string;
  /** Background the sample is painted on: its own, else the nearest ancestor's. */
  effBg: string;
  text?: string;
  /** Visible border sides with width >= 1px. */
  borders: { hex: string; width: number; length: number }[];
}

export interface ColorAnalysis {
  colors: DesignScan['colors'];
  perSample: SampleColors[];
  /** Palette token for any hex found on the page (nearest by ΔE2000). */
  tokenOf: (hex: string) => ColorToken | undefined;
  roleOf: (hex: string) => ColorRole | undefined;
  pageBg: string;
}

const PAGE_DEFAULT_BG = '#ffffff';
const parseCache = new Map<string, Rgba | null>();
function parse(css: string | undefined): Rgba | null {
  if (!css) return null;
  let v = parseCache.get(css);
  if (v === undefined) {
    v = parseColor(css);
    parseCache.set(css, v);
  }
  return v;
}

/** Composite `fg` over the opaque hex `under`; fully transparent → null. */
function resolve(css: string | undefined, under: string): string | null {
  const c = parse(css);
  if (!c || c.alpha <= 0.004) return null;
  if (c.alpha >= 1) return toHex(c);
  const base = parse(under) ?? { r: 1, g: 1, b: 1, alpha: 1 };
  return toHex(composite(c, base));
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;

/**
 * Pass 1: resolve every sample's colors. Translucent colors are composited over the
 * nearest opaque ancestor background, found by walking the document-ordered samples with a
 * depth stack (a pragmatic stand-in for rect containment: ancestors precede descendants and
 * have a smaller depth). With no ancestor background, white (the browser canvas) is assumed.
 */
function resolveSamples(raw: RawPage): SampleColors[] {
  const stack: { depth: number; hex: string }[] = [];
  return raw.samples.map((smp) => {
    while (stack.length > 0 && (stack[stack.length - 1] as { depth: number }).depth >= smp.depth) {
      stack.pop();
    }
    const parentBg =
      stack.length > 0 ? (stack[stack.length - 1] as { hex: string }).hex : PAGE_DEFAULT_BG;
    const own = resolve(smp.s.backgroundColor, parentBg);
    const effBg = own ?? parentBg;
    if (own) stack.push({ depth: smp.depth, hex: own });
    const out: SampleColors = { effBg, borders: [] };
    if (own) out.ownBg = own;
    const text = resolve(smp.s.color, effBg);
    if (text) out.text = text;
    for (const side of SIDES) {
      const w = px(smp.s[`border${side}Width` as 'borderTopWidth']);
      const hex = resolve(smp.s[`border${side}Color` as 'borderTopColor'], effBg);
      if (w !== null && w >= 1 && hex) {
        const length = side === 'Top' || side === 'Bottom' ? smp.rect[2] : smp.rect[3];
        out.borders.push({ hex, width: w, length });
      }
    }
    return out;
  });
}

// ---- role naming from CSS custom properties --------------------------------------------------

const VAR_RULES: [RegExp, ColorRole][] = [
  [/(accent|brand|primary|cta).*(fg|foreground|text|contrast)$/, 'accentForeground'],
  [/^(color-)?(accent|brand|primary)(-(color|default|base|500|600))?$/, 'accent'],
  [/^(color-)?(bg|background|page-bg|bg-page|bg-primary|bg-default)$/, 'background'],
  [/^(color-)?(surface|card|bg-surface|bg-card|bg-secondary|bg-elevated)$/, 'surface'],
  [/^(color-)?(text|foreground|fg|text-primary|text-default|body)$/, 'textPrimary'],
  [
    /^(color-)?(text-secondary|text-muted|muted-foreground|fg-muted|text-subtle|muted)$/,
    'textSecondary',
  ],
  [/^(color-)?(border|border-color|border-default|divider)$/, 'border'],
];

export const CSS_VAR_HINT = /primary|brand|accent|bg|background|foreground|fg|muted|border|ring/;

function roleFromVar(name: string): ColorRole | undefined {
  const n = name.replace(/^--/, '').toLowerCase();
  for (const [re, role] of VAR_RULES) if (re.test(n)) return role;
  return undefined;
}

const HUE_BANDS: [ColorRole, number, number][] = [
  ['success', 120, 165],
  ['warning', 60, 95],
  ['danger', 15, 38],
];

export interface ColorOptions {
  neutralThreshold?: number;
  chromaticThreshold?: number;
}

export function analyzeColors(raw: RawPage, opts: ColorOptions = {}): ColorAnalysis {
  const perSample = resolveSamples(raw);

  // ---- weights, pre-aggregated per (usage, hex) so clustering sees hundreds of entries ----
  const agg = new Map<string, number>();
  const key = (u: ColorEntry['usage'], hex: string) => `${u}|${hex}`;
  const body = raw.samples.find((s) => s.tag === 'body');
  const bodyHasBg = !!body && perSample[body.i]?.ownBg !== undefined;
  let coveredTop = 0;
  raw.samples.forEach((smp, idx) => {
    const c = perSample[idx] as SampleColors;
    const a = area(smp);
    if (c.ownBg) {
      bump(agg, key('bg', c.ownBg), a);
      if (smp.depth === 1) coveredTop += a;
    }
    const fs = px(smp.s.fontSize) ?? 16;
    if (c.text && smp.text && smp.text.len > 0)
      bump(agg, key('text', c.text), smp.text.len * fs * fs);
    else if (c.text && smp.tag === 'svg') bump(agg, key('fill', c.text), a);
    for (const b of c.borders) bump(agg, key('border', b.hex), b.length * b.width);
  });
  const docArea = raw.doc.w * raw.doc.h;
  if (!bodyHasBg)
    bump(agg, key('bg', PAGE_DEFAULT_BG), Math.max(docArea * 0.05, docArea - coveredTop));

  const entries: ColorEntry[] = [...agg].map(([k, weight]) => {
    const [usage, color] = k.split('|') as [ColorEntry['usage'], string];
    return { color, weight, usage };
  });
  const palette = clusterColors(entries, {
    neutralThreshold: opts.neutralThreshold,
    chromaticThreshold: opts.chromaticThreshold,
  });

  // ---- hex → token mapping (nearest by ΔE2000) ----
  const nearest = new Map<string, ColorToken | undefined>();
  const tokenOf = (hex: string): ColorToken | undefined => {
    if (nearest.has(hex)) return nearest.get(hex);
    let best: ColorToken | undefined;
    let bd = Number.POSITIVE_INFINITY;
    for (const t of palette) {
      if (t.hex === hex) {
        best = t;
        break;
      }
      const d = deltaE2000(hex, t.hex);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    nearest.set(hex, best);
    return best;
  };

  const roles: Partial<Record<ColorRole, string>> = {};
  const byId = new Map(palette.map((t) => [t.id, t]));
  const chroma = (t: ColorToken) => t.oklch[1];

  // ---- background ----
  const topBg = new Map<string, number>();
  raw.samples.forEach((smp, idx) => {
    const c = perSample[idx] as SampleColors;
    if (c.ownBg && (smp.tag === 'body' || smp.tag === 'main' || smp.depth <= 1)) {
      const t = tokenOf(c.ownBg);
      if (t) bump(topBg, t.id, area(smp));
    }
  });
  if (!bodyHasBg) {
    const t = tokenOf(PAGE_DEFAULT_BG);
    if (t) bump(topBg, t.id, Math.max(docArea * 0.05, docArea - coveredTop));
  }
  const bgId = ranked(topBg)[0]?.[0] ?? palette.find((t) => t.usage.bg > 0)?.id;
  if (bgId) roles.background = bgId;
  const bgToken = bgId ? byId.get(bgId) : undefined;
  const bgHex = bgToken?.hex ?? PAGE_DEFAULT_BG;

  // ---- surface / surfaceAlt: card-like backgrounds close in lightness to the background ----
  const cardBg = new Map<string, number>();
  raw.samples.forEach((smp, idx) => {
    const c = perSample[idx] as SampleColors;
    if (!c.ownBg || smp.interactive || smp.tag === 'body') return;
    const cardLike =
      (smp.s.borderRadius && smp.s.borderRadius !== '0px') ||
      smp.s.boxShadow ||
      c.borders.length > 0;
    if (!cardLike) return;
    const t = tokenOf(c.ownBg);
    if (t && t.id !== bgId && bgToken && Math.abs(t.oklch[0] - bgToken.oklch[0]) <= 0.12) {
      bump(cardBg, t.id, area(smp));
    }
  });
  const surfaces = ranked(cardBg);
  if (surfaces[0]) roles.surface = surfaces[0][0];
  if (surfaces[1]) roles.surfaceAlt = surfaces[1][0];

  // ---- text ----
  const textTokens = palette
    .filter((t) => t.usage.text > 0)
    .sort((a, b) => b.usage.text - a.usage.text);
  const primary = textTokens[0];
  if (primary) roles.textPrimary = primary.id;
  const ratioOf = (t: ColorToken) => contrast(t.hex, bgHex);
  if (primary) {
    const lower = textTokens.filter(
      (t) =>
        t.id !== primary.id && chroma(t) < 0.06 && ratioOf(t) < ratioOf(primary) && ratioOf(t) >= 2,
    );
    const second = lower[0];
    if (second) {
      roles.textSecondary = second.id;
      const muted = lower.find((t) => t.id !== second.id && ratioOf(t) < ratioOf(second));
      if (muted) roles.textMuted = muted.id;
    }
  }

  // ---- accent: chromatic bg on buttons / link color, by count ----
  const accentVotes = new Map<string, number>();
  const onAccent = new Map<string, Map<string, number>>();
  raw.samples.forEach((smp, idx) => {
    const c = perSample[idx] as SampleColors;
    if (smp.interactive === 'button' && c.ownBg) {
      const t = tokenOf(c.ownBg);
      if (t && t.id !== bgId && chroma(t) > 0.06) {
        bump(accentVotes, t.id, 1);
        const tt = c.text && tokenOf(c.text);
        if (tt) {
          const m = onAccent.get(t.id) ?? new Map<string, number>();
          bump(m, tt.id, 1);
          onAccent.set(t.id, m);
        }
      }
    } else if (smp.interactive === 'link' && c.text) {
      const t = tokenOf(c.text);
      if (t && chroma(t) > 0.06) bump(accentVotes, t.id, 1);
    }
  });
  let accentId = ranked(accentVotes).sort(
    (a, b) =>
      b[1] - a[1] || chroma(byId.get(b[0]) as ColorToken) - chroma(byId.get(a[0]) as ColorToken),
  )[0]?.[0];
  if (!accentId) {
    accentId = palette
      .filter((t) => chroma(t) > 0.06)
      .sort(
        (a, b) =>
          (b.usage.bg + b.usage.fill + b.usage.text) * chroma(b) -
          (a.usage.bg + a.usage.fill + a.usage.text) * chroma(a),
      )[0]?.id;
  }
  if (accentId) roles.accent = accentId;

  // ---- link: most common non-primary chromatic link color ----
  const linkVotes = new Map<string, number>();
  raw.samples.forEach((smp, idx) => {
    const c = perSample[idx] as SampleColors;
    if (smp.interactive !== 'link' || !c.text) return;
    const t = tokenOf(c.text);
    if (t && t.id !== roles.textPrimary && chroma(t) > 0.06) bump(linkVotes, t.id, 1);
  });
  const link = ranked(linkVotes)[0];
  if (link) roles.link = link[0];

  // ---- border ----
  const borderVotes = new Map<string, number>();
  perSample.forEach((c) => {
    for (const b of c.borders) {
      const t = tokenOf(b.hex);
      if (t) bump(borderVotes, t.id, b.length * b.width);
    }
  });
  const border = ranked(borderVotes)[0];
  if (border) roles.border = border[0];

  // ---- semantic hues ----
  for (const [role, lo, hi] of HUE_BANDS) {
    const t = palette
      .filter(
        (p) =>
          p.id !== roles.accent &&
          chroma(p) >= 0.1 &&
          p.oklch[0] > 0.35 &&
          p.oklch[0] < 0.9 &&
          p.oklch[2] >= lo &&
          p.oklch[2] <= hi,
      )
      .sort((a, b) => b.weight - a.weight)[0];
    if (t) roles[role] = t.id;
  }

  // ---- CSS variable hints override the heuristics ----
  const tokens = palette.map((t) => ({ ...t }));
  const tokenById = new Map(tokens.map((t) => [t.id, t]));
  const hinted = new Set<ColorRole>();
  for (const [name, value] of Object.entries(raw.rootVars)) {
    if (!CSS_VAR_HINT.test(name.toLowerCase())) continue;
    const role = roleFromVar(name);
    if (!role || hinted.has(role)) continue;
    const c = parse(value);
    if (!c || c.alpha < 1) continue;
    const hex = toHex(c);
    let best: ColorToken | undefined;
    let bd = 3;
    for (const t of tokens) {
      const d = t.hex === hex ? 0 : deltaE2000(hex, t.hex);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (!best) continue;
    if (role === 'accent' && chroma(best) < 0.04) continue;
    if (role === 'textPrimary' && best.usage.text <= 0) continue;
    if ((role === 'background' || role === 'surface') && best.usage.bg <= 0) continue;
    roles[role] = best.id;
    hinted.add(role);
    const tok = tokenById.get(best.id);
    if (tok && !tok.sourceVar) tok.sourceVar = name;
  }

  // ---- accentForeground: text color on accent buttons (unless hinted) ----
  if (roles.accent && !hinted.has('accentForeground')) {
    const m = onAccent.get(roles.accent);
    const top = m && ranked(m)[0];
    if (top) roles.accentForeground = top[0];
  }

  // ---- gradients ----
  const grads = new Map<string, number>();
  for (const smp of raw.samples) {
    const bi = smp.s.backgroundImage;
    if (bi?.includes('gradient(')) bump(grads, bi, area(smp));
  }
  const gTotal = [...grads.values()].reduce((a, b) => a + b, 0);
  const gradients = ranked(grads)
    .slice(0, 6)
    .map(([css, w]) => ({ css, weight: gTotal > 0 ? w / gTotal : 0 }));

  const roleByTokenId = new Map<string, ColorRole>();
  for (const [r, id] of Object.entries(roles) as [ColorRole, string][]) {
    if (!roleByTokenId.has(id)) roleByTokenId.set(id, r);
  }
  return {
    colors: { palette: tokens, roles, gradients },
    perSample,
    tokenOf,
    roleOf: (hex) => {
      const t = tokenOf(hex);
      return t ? roleByTokenId.get(t.id) : undefined;
    },
    pageBg: bgHex,
  };
}
