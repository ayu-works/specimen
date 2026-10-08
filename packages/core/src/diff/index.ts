import { deltaE2000 } from '../color';
import { usableSections } from '../generate/blueprint';
import { fmt, radiusText, roleHex } from '../generate/common';
import { fontInfo } from '../generate/fonts';
import type { ColorRole, DesignScan, TypeStyle } from '../schema';

export type FidelityFacet = 'colors' | 'typography' | 'spacing' | 'shape' | 'layout';
export type Severity = 'high' | 'medium' | 'low';

export interface FacetScore {
  score: number;
  weight: number;
}

export interface FidelityDelta {
  facet: FidelityFacet;
  item: string;
  expected: string;
  actual: string;
  severity: Severity;
  hint: string;
  /** Imperative instruction for the fix prompt when "change actual to expected" isn't enough. */
  fix?: string;
}

export interface FidelityReport {
  /** 0–100, weighted over the facets. */
  score: number;
  facets: Record<FidelityFacet, FacetScore>;
  /** Most important first. */
  deltas: FidelityDelta[];
}

export const FACET_WEIGHTS: Record<FidelityFacet, number> = {
  colors: 30,
  typography: 25,
  spacing: 15,
  shape: 15,
  layout: 15,
};

export const FACET_NAMES: Record<FidelityFacet, string> = {
  colors: 'Colors',
  typography: 'Type',
  spacing: 'Spacing',
  shape: 'Shape',
  layout: 'Layout',
};

interface Item {
  facet: FidelityFacet;
  name: string;
  /** Relative importance inside the facet. */
  weight: number;
  /** 0–100. */
  score: number;
  expected: string;
  actual: string;
  hint: string;
  fix?: string;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

/** 100 within `tol` (relative), falling linearly to 0 at 4 × tol. */
function relScore(expected: number, actual: number, tol: number): number {
  if (expected === actual) return 100;
  const base = Math.max(Math.abs(expected), 1e-9);
  const rel = Math.abs(expected - actual) / base;
  if (rel <= tol) return 100;
  return clamp(100 * (1 - (rel - tol) / (3 * tol)));
}

/** ΔE2000 → score: ≤ 1 is identical to the eye (100), ≥ 20 is a different color (0). */
function colorScore(de: number): number {
  if (de <= 1) return 100;
  return clamp(100 * (1 - (de - 1) / 19));
}

// ---- colors -----------------------------------------------------------------------------

const ROLE_WEIGHT: Record<ColorRole, number> = {
  background: 3,
  surface: 2,
  surfaceAlt: 1,
  textPrimary: 3,
  textSecondary: 2,
  textMuted: 1,
  border: 2,
  accent: 3,
  accentHover: 0.5,
  accentForeground: 1.5,
  link: 1,
  success: 0.5,
  warning: 0.5,
  danger: 0.5,
};

const ROLE_LABEL: Record<ColorRole, string> = {
  background: 'Page background',
  surface: 'Surface (cards, panels)',
  surfaceAlt: 'Alternate surface',
  textPrimary: 'Primary text',
  textSecondary: 'Secondary text',
  textMuted: 'Muted text',
  border: 'Border',
  accent: 'Accent',
  accentHover: 'Accent hover',
  accentForeground: 'Text on accent',
  link: 'Link',
  success: 'Success color',
  warning: 'Warning color',
  danger: 'Danger color',
};

function colorItems(source: DesignScan, build: DesignScan): Item[] {
  const out: Item[] = [];
  for (const role of Object.keys(ROLE_WEIGHT) as ColorRole[]) {
    const want = roleHex(source, role);
    if (!want) continue;
    const got = roleHex(build, role);
    const label = ROLE_LABEL[role];
    if (!got) {
      out.push({
        facet: 'colors',
        name: label,
        weight: ROLE_WEIGHT[role],
        score: 0,
        expected: want,
        actual: 'missing',
        hint: `${label} (${want}) is not used in your build.`,
      });
      continue;
    }
    const de = deltaE2000(want, got);
    out.push({
      facet: 'colors',
      name: label,
      weight: ROLE_WEIGHT[role],
      score: colorScore(de),
      expected: want,
      actual: got,
      hint: `${label} is ${got}; source uses ${want} (color distance ${fmt(de, 1)}).`,
    });
  }
  return out;
}

// ---- typography -------------------------------------------------------------------------

type Slot = 'body' | 'h1' | 'h2' | 'h3';
const SLOTS: { slot: Slot; label: string; weight: number }[] = [
  { slot: 'body', label: 'Body text', weight: 3 },
  { slot: 'h1', label: 'Main heading (h1)', weight: 3 },
  { slot: 'h2', label: 'Section heading (h2)', weight: 2 },
  { slot: 'h3', label: 'Subheading (h3)', weight: 1 },
];

function styleFor(scan: DesignScan, slot: Slot): TypeStyle | undefined {
  const styles = scan.typography.styles;
  if (slot === 'h1') {
    const cands = styles.filter((s) => s.role === 'h1' || s.role === 'display');
    return cands.sort((a, b) => b.size - a.size)[0];
  }
  return styles.find((s) => s.role === slot);
}

/** Lower-cased, punctuation-free family name without foundry noise. */
export function normalizeFamily(name: string): string {
  return name
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\b(variable|vf|display|text|pro|std|var)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function stackNames(stack: string): string[] {
  return stack
    .split(',')
    .map((p) => normalizeFamily(p))
    .filter((p) => p && !['sansserif', 'serif', 'monospace', 'systemui'].includes(p));
}

function familyOfStyle(scan: DesignScan, s: TypeStyle | undefined) {
  return s ? scan.typography.families.find((f) => f.id === s.familyId) : undefined;
}

function familyItem(
  source: DesignScan,
  build: DesignScan,
  slot: 'body' | 'h1',
  label: string,
): Item | null {
  const sf = familyOfStyle(source, styleFor(source, slot));
  if (!sf) return null;
  const bf = familyOfStyle(build, styleFor(build, slot));
  const info = fontInfo(source, sf);
  const expected = info.alternative ? `${info.label} (or ${info.alternative})` : info.label;
  const actual = bf ? bf.name : 'missing';
  let match = false;
  if (bf) {
    const want = new Set<string>([normalizeFamily(sf.name), ...stackNames(sf.stack).slice(0, 1)]);
    if (info.alternative) want.add(normalizeFamily(info.alternative));
    const got = [normalizeFamily(bf.name), ...stackNames(bf.stack).slice(0, 2)];
    match = got.some((g) => want.has(g));
  }
  return {
    facet: 'typography',
    name: label,
    weight: 2,
    score: match ? 100 : 0,
    expected,
    actual,
    hint: match
      ? ''
      : `${label} is ${actual}; source uses ${info.branded ? `a custom face (use ${info.alternative ?? 'a similar font'})` : expected}.`,
  };
}

function typeItems(source: DesignScan, build: DesignScan): Item[] {
  const out: Item[] = [];
  for (const f of [
    familyItem(source, build, 'h1', 'Heading font'),
    familyItem(source, build, 'body', 'Body font'),
  ]) {
    if (f) out.push(f);
  }
  for (const { slot, label, weight } of SLOTS) {
    const s = styleFor(source, slot);
    if (!s) continue;
    const b = styleFor(build, slot);
    if (!b) {
      out.push({
        facet: 'typography',
        name: label,
        weight,
        score: 0,
        expected: `${s.size}px / ${s.weight}`,
        actual: 'missing',
        hint: `${label} is missing; source uses ${s.size}px, weight ${s.weight}.`,
      });
      continue;
    }
    const rel = Math.abs(s.size - b.size) / s.size;
    const sizeScore = rel <= 0.03 ? 100 : clamp(100 * (1 - rel / 0.5));
    const weightScore = clamp(100 - (Math.abs(s.weight - b.weight) / 100) * 35);
    const lhScore = clamp(100 - (Math.abs(s.lineHeight - b.lineHeight) / 0.1) * 12);
    const score = 0.5 * sizeScore + 0.25 * weightScore + 0.25 * lhScore;
    const parts: string[] = [];
    if (Math.abs(s.size - b.size) / s.size > 0.04)
      parts.push(`size ${b.size}px (source ${s.size}px)`);
    if (s.weight !== b.weight) parts.push(`weight ${b.weight} (source ${s.weight})`);
    if (Math.abs(s.lineHeight - b.lineHeight) > 0.08)
      parts.push(`line height ${fmt(b.lineHeight)} (source ${fmt(s.lineHeight)})`);
    out.push({
      facet: 'typography',
      name: label,
      weight,
      score: parts.length === 0 ? 100 : score,
      expected: `${s.size}px / ${s.weight} / ${fmt(s.lineHeight)}`,
      actual: `${b.size}px / ${b.weight} / ${fmt(b.lineHeight)}`,
      hint: `${label}: ${parts.join(', ')}.`,
    });
  }
  return out;
}

// ---- spacing ----------------------------------------------------------------------------

function spacingItems(source: DesignScan, build: DesignScan): Item[] {
  const s = source.spacing;
  const b = build.spacing;
  const out: Item[] = [];
  let baseScore = 20;
  if (s.baseUnit === b.baseUnit) baseScore = 100;
  else if (s.baseUnit % b.baseUnit === 0 || b.baseUnit % s.baseUnit === 0) baseScore = 50;
  out.push({
    facet: 'spacing',
    name: 'Spacing base unit',
    weight: 2,
    score: baseScore,
    expected: `${s.baseUnit}px`,
    actual: `${b.baseUnit}px`,
    hint: `Spacing is built on a ${b.baseUnit}px unit; source uses ${s.baseUnit}px.`,
  });
  if (s.sectionPaddingY > 0) {
    out.push({
      facet: 'spacing',
      name: 'Section vertical padding',
      weight: 3,
      score: relScore(s.sectionPaddingY, b.sectionPaddingY, 0.15),
      expected: `${s.sectionPaddingY}px`,
      actual: `${b.sectionPaddingY}px`,
      hint: `Section vertical padding is ${b.sectionPaddingY}px; source uses ${s.sectionPaddingY}px.`,
    });
  }
  if (s.contentGap > 0) {
    out.push({
      facet: 'spacing',
      name: 'Gap between content blocks',
      weight: 2,
      score: relScore(s.contentGap, b.contentGap, 0.25),
      expected: `${s.contentGap}px`,
      actual: `${b.contentGap}px`,
      hint: `Gap between content blocks is ${b.contentGap}px; source uses ${s.contentGap}px.`,
    });
  }
  return out;
}

// ---- shape ------------------------------------------------------------------------------

function radiusScore(expected: number, actual: number, bothPill: boolean): number {
  if (bothPill) return 100;
  const pill = (v: number) => v >= 100;
  if (pill(expected) && pill(actual)) return 100;
  // pill vs. a modest radius is a clear shape change
  if (pill(expected) || pill(actual)) return Math.min(expected, actual) >= 24 ? 30 : 0;
  const d = Math.abs(expected - actual);
  if (d <= 2) return 100;
  return clamp(100 - (d - 2) * 8);
}

function shapeItems(source: DesignScan, build: DesignScan): Item[] {
  const out: Item[] = [];
  const bothPill = source.radii.pillButtons && build.radii.pillButtons;
  const radii: [string, number | undefined, number | undefined, number, boolean][] = [
    [
      'Button radius',
      source.radii.pillButtons ? 9999 : (source.radii.button ?? undefined),
      build.radii.pillButtons ? 9999 : (build.radii.button ?? undefined),
      3,
      true,
    ],
    ['Card radius', source.radii.card, build.radii.card, 2, false],
    ['Input radius', source.radii.input, build.radii.input, 1, false],
  ];
  for (const [name, want, got, weight, isButton] of radii) {
    if (want === undefined) continue;
    const label = name.replace(' radius', '');
    const labelBtn = isButton ? 'Primary button' : label;
    if (got === undefined) {
      out.push({
        facet: 'shape',
        name,
        weight,
        score: 40,
        expected: radiusText(want),
        actual: 'not found',
        hint: `No ${label.toLowerCase()} with rounded corners was found in your build; source uses ${radiusText(want)}.`,
      });
      continue;
    }
    out.push({
      facet: 'shape',
      name,
      weight,
      score: radiusScore(want, got, bothPill && isButton),
      expected: radiusText(want),
      actual: radiusText(got),
      hint: `${labelBtn} radius is ${radiusText(got)}; source uses ${radiusText(want)}.`,
    });
  }
  // Shadows: which levels exist and how many distinct shadows there are.
  const lv = (s: DesignScan) => new Set(s.shadows.map((x) => x.level));
  const sl = lv(source);
  const bl = lv(build);
  const union = new Set([...sl, ...bl]);
  const inter = [...sl].filter((x) => bl.has(x)).length;
  const jaccard = union.size === 0 ? 1 : inter / union.size;
  const cs = source.shadows.length;
  const cb = build.shadows.length;
  const countSim = cs === 0 && cb === 0 ? 1 : Math.min(cs, cb) / Math.max(cs, cb);
  const levels = (s: Set<number>) => (s.size === 0 ? 'none' : `levels ${[...s].sort().join(', ')}`);
  const describe = (n: number, s: Set<number>) =>
    n === 0 ? 'no shadows' : `${n} shadow${n === 1 ? '' : 's'} (${levels(s)})`;
  out.push({
    facet: 'shape',
    name: 'Shadows',
    weight: 2,
    score: 100 * (0.6 * jaccard + 0.4 * countSim),
    expected: describe(cs, sl),
    actual: describe(cb, bl),
    hint:
      cs === 0
        ? 'Source has no shadows; remove them and separate with borders.'
        : cb === 0
          ? `Your build has no shadows; source uses ${cs} (${levels(sl)}).`
          : `Shadows: your build has ${cb} (${levels(bl)}); source has ${cs} (${levels(sl)}).`,
    fix: shadowFix(source),
  });
  const bw = (s: DesignScan) => s.borders[0]?.width ?? 0;
  out.push({
    facet: 'shape',
    name: 'Border width',
    weight: 1,
    score: bw(source) === bw(build) ? 100 : clamp(100 - Math.abs(bw(source) - bw(build)) * 40),
    expected: `${bw(source)}px`,
    actual: `${bw(build)}px`,
    hint: `Borders are ${bw(build)}px; source uses ${bw(source)}px.`,
  });
  return out;
}

// ---- layout -----------------------------------------------------------------------------

/** Elevation as concrete CSS, one representative (highest-weight) shadow per level. */
function shadowFix(source: DesignScan): string {
  if (source.shadows.length === 0) {
    return 'Shadows: remove box-shadows; separate surfaces with 1px borders instead.';
  }
  const byLevel = new Map<number, string>();
  for (const sh of [...source.shadows].sort((a, b) => b.weight - a.weight)) {
    if (!byLevel.has(sh.level)) byLevel.set(sh.level, sh.css);
  }
  const parts = [...byLevel]
    .sort((a, b) => a[0] - b[0])
    .map(([lvl, css]) => `level ${lvl} \`${css}\``);
  return `Shadows: use exactly these elevation styles: ${parts.join('; ')}.`;
}

/**
 * Section structure as add/remove instructions plus the target order of distinctive sections.
 * Generic "content" bands are left out: listing them ("content > content > …") is noise.
 */
function sectionFix(target: string[], build: string[]): string {
  const generic = new Set(['content', 'unknown']);
  const count = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) if (!generic.has(x)) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const t = count(target);
  const b = count(build);
  const missing = [...t].filter(([k, n]) => (b.get(k) ?? 0) < n).map(([k]) => k);
  const extra = [...b].filter(([k, n]) => (t.get(k) ?? 0) < n).map(([k]) => k);
  const order = target
    .filter((k) => !generic.has(k))
    .filter((k, i, a) => i === 0 || a[i - 1] !== k);
  const parts: string[] = [];
  if (missing.length) parts.push(`add ${missing.map((k) => `a ${k} section`).join(', ')}`);
  if (extra.length)
    parts.push(`remove the ${extra.join(', ')} section${extra.length > 1 ? 's' : ''}`);
  parts.push(`keep the key sections in this order: ${order.join(' → ')}`);
  return `Sections: ${parts.join('; ')}.`;
}

function lcs(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = dp[i] as number[];
      const prev = dp[i - 1] as number[];
      row[j] =
        a[i - 1] === b[j - 1]
          ? (prev[j - 1] as number) + 1
          : Math.max(prev[j] as number, row[j - 1] as number);
    }
  }
  return (dp[a.length] as number[])[b.length] as number;
}

const DENSITY = ['compact', 'comfortable', 'airy'] as const;

function layoutItems(source: DesignScan, build: DesignScan): Item[] {
  const out: Item[] = [];
  const sc = source.layout.containerMaxWidth;
  const bc = build.layout.containerMaxWidth;
  if (sc !== null) {
    out.push({
      facet: 'layout',
      name: 'Container width',
      weight: 3,
      score: bc === null ? 50 : relScore(sc, bc, 0.05),
      expected: `${sc}px`,
      actual: bc === null ? 'fluid' : `${bc}px`,
      hint: `Content container is ${bc === null ? 'fluid' : `${bc}px`} wide; source is ${sc}px, centered.`,
    });
  }
  const sk = usableSections(source, 20).map((s) => s.kind);
  const bk = usableSections(build, 20).map((s) => s.kind);
  if (sk.length > 0) {
    const ratio = bk.length === 0 ? 0 : (2 * lcs(sk, bk)) / (sk.length + bk.length);
    out.push({
      facet: 'layout',
      name: 'Section order',
      weight: 4,
      score: ratio * 100,
      expected: sk.join(' > '),
      actual: bk.join(' > ') || 'none',
      hint: `Page sections are ${bk.join(', ') || 'missing'}; source is ${sk.join(', ')}.`,
      fix: sectionFix(sk, bk),
    });
  }
  const sd = source.layout.density;
  const bd = build.layout.density;
  const dd = Math.abs(DENSITY.indexOf(sd) - DENSITY.indexOf(bd));
  out.push({
    facet: 'layout',
    name: 'Density',
    weight: 2,
    score: dd === 0 ? 100 : dd === 1 ? 50 : 0,
    expected: sd,
    actual: bd,
    hint: `Layout feels ${bd}; source is ${sd} (adjust section padding and gaps).`,
  });
  return out;
}

// ---- report -----------------------------------------------------------------------------

function severityOf(score: number, weight: number): Severity | null {
  if (score >= 94) return null;
  let sev: Severity = score < 35 ? 'high' : score < 70 ? 'medium' : 'low';
  if (weight <= 1 && sev === 'high') sev = 'medium';
  else if (weight <= 0.5 && sev === 'medium') sev = 'low';
  return sev;
}

const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Compare a build scan against the source (target) design. Same scan vs itself = 100.
 * Facet weights: colors 30, type 25, spacing 15, shape 15, layout 15.
 */
export function diffScans(source: DesignScan, build: DesignScan): FidelityReport {
  const groups: Record<FidelityFacet, Item[]> = {
    colors: colorItems(source, build),
    typography: typeItems(source, build),
    spacing: spacingItems(source, build),
    shape: shapeItems(source, build),
    layout: layoutItems(source, build),
  };
  const facets = {} as Record<FidelityFacet, FacetScore>;
  const ranked: { delta: FidelityDelta; loss: number }[] = [];
  let weighted = 0;
  let weightSum = 0;
  for (const facet of Object.keys(groups) as FidelityFacet[]) {
    const items = groups[facet];
    const total = items.reduce((a, i) => a + i.weight, 0);
    const score = total === 0 ? 100 : items.reduce((a, i) => a + i.score * i.weight, 0) / total;
    facets[facet] = { score: Math.round(score), weight: FACET_WEIGHTS[facet] };
    weighted += score * FACET_WEIGHTS[facet];
    weightSum += FACET_WEIGHTS[facet];
    for (const it of items) {
      const sev = severityOf(it.score, it.weight);
      if (!sev || !it.hint) continue;
      ranked.push({
        delta: {
          facet,
          item: it.name,
          expected: it.expected,
          actual: it.actual,
          severity: sev,
          hint: it.hint,
          ...(it.fix ? { fix: it.fix } : {}),
        },
        loss: total === 0 ? 0 : ((100 - it.score) * it.weight * FACET_WEIGHTS[facet]) / total,
      });
    }
  }
  ranked.sort((a, b) => SEV_RANK[a.delta.severity] - SEV_RANK[b.delta.severity] || b.loss - a.loss);
  return {
    score: Math.round(weightSum === 0 ? 100 : weighted / weightSum),
    facets,
    deltas: ranked.map((r) => r.delta),
  };
}
