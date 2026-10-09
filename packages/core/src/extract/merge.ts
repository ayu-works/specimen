import { computeA11y } from '../a11y';
import { type ColorEntry, clusterColors, deltaE2000 } from '../color';
import type { ColorRole, ColorToken, DesignScan, TypeStyle } from '../schema';
import { DesignScanSchema } from '../schema';
import { densityOf } from './layout';

type Colors = DesignScan['colors'];

/** How many pages a scan already represents (merged scans count once per page). */
function pagesOf(s: DesignScan): number {
  return Math.max(1, s.meta.pages?.length ?? 1);
}

/** Weighted mode of numbers (ties: the smaller value). */
function weightedMode(items: { v: number; w: number }[]): number | undefined {
  const m = new Map<number, number>();
  for (const { v, w } of items) m.set(v, (m.get(v) ?? 0) + w);
  let best: number | undefined;
  let bw = -1;
  for (const [v, w] of [...m].sort((a, b) => a[0] - b[0])) {
    if (w > bw) {
      best = v;
      bw = w;
    }
  }
  return best;
}

function weightedMedian(items: { v: number; w: number }[]): number | undefined {
  if (items.length === 0) return undefined;
  const sorted = [...items].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((a, b) => a + b.w, 0);
  let acc = 0;
  for (const it of sorted) {
    acc += it.w;
    if (acc >= total / 2) return it.v;
  }
  return sorted[sorted.length - 1]?.v;
}

const USAGES = ['bg', 'text', 'border', 'fill'] as const;

function mergeColors(scans: DesignScan[], mult: number[]): Colors {
  const entries: ColorEntry[] = [];
  scans.forEach((s, i) => {
    const m = mult[i] ?? 1;
    for (const t of s.colors.palette) {
      let any = false;
      for (const u of USAGES) {
        const w = t.usage[u] * m;
        if (w > 0) {
          entries.push({ color: t.hex, weight: w, usage: u });
          any = true;
        }
      }
      if (!any && t.weight > 0) entries.push({ color: t.hex, weight: t.weight * m, usage: 'fill' });
    }
  });
  // Same neutral threshold as extract(), so merging a page with itself keeps its palette.
  const palette: ColorToken[] = clusterColors(entries, { neutralThreshold: 0.8 });
  const keepVars = new Map<string, string>();
  for (const s of scans) {
    for (const t of s.colors.palette) {
      if (t.sourceVar) keepVars.set(t.hex, keepVars.get(t.hex) ?? t.sourceVar);
    }
  }
  for (const t of palette) {
    const v = keepVars.get(t.hex);
    if (v) t.sourceVar = v;
  }

  // Roles: the hex most pages agree on (by summed page weight), mapped to the new palette.
  const roles: Partial<Record<ColorRole, string>> = {};
  const roleNames = new Set<ColorRole>();
  for (const s of scans)
    for (const r of Object.keys(s.colors.roles) as ColorRole[]) roleNames.add(r);
  for (const role of roleNames) {
    const votes: { hex: string; w: number }[] = [];
    scans.forEach((s, i) => {
      const id = s.colors.roles[role];
      const hex = id ? s.colors.palette.find((t) => t.id === id)?.hex : undefined;
      if (hex) votes.push({ hex, w: mult[i] ?? 1 });
    });
    // Group near-identical hexes, then take the heaviest group's heaviest member.
    const groups: { hex: string; w: number }[] = [];
    for (const v of votes) {
      const g = groups.find((x) => x.hex === v.hex || deltaE2000(x.hex, v.hex) < 3);
      if (g) g.w += v.w;
      else groups.push({ ...v });
    }
    const top = groups.sort((a, b) => b.w - a.w)[0];
    if (!top) continue;
    let best: ColorToken | undefined;
    let bd = Number.POSITIVE_INFINITY;
    for (const t of palette) {
      const d = t.hex === top.hex ? 0 : deltaE2000(t.hex, top.hex);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (best) roles[role] = best.id;
  }

  const grads = new Map<string, number>();
  scans.forEach((s, i) => {
    for (const g of s.colors.gradients)
      grads.set(g.css, (grads.get(g.css) ?? 0) + g.weight * (mult[i] ?? 1));
  });
  const gTotal = [...grads.values()].reduce((a, b) => a + b, 0);
  const gradients = [...grads]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([css, w]) => ({ css, weight: gTotal > 0 ? w / gTotal : 0 }));
  return { palette, roles, gradients };
}

function mergeTypography(scans: DesignScan[], mult: number[]): DesignScan['typography'] {
  const best = new Map<TypeStyle['role'], { style: TypeStyle; score: number; from: number }>();
  scans.forEach((s, i) => {
    for (const st of s.typography.styles) {
      const score = st.weightShare * (mult[i] ?? 1);
      const cur = best.get(st.role);
      if (!cur || score > cur.score) best.set(st.role, { style: st, score, from: i });
    }
  });
  const families = new Map<string, DesignScan['typography']['families'][number]>();
  const styles: TypeStyle[] = [];
  for (const { style, from } of best.values()) {
    const fam = scans[from]?.typography.families.find((f) => f.id === style.familyId);
    if (fam) {
      const prev = families.get(fam.id);
      families.set(
        fam.id,
        prev ? { ...prev, weights: [...new Set([...prev.weights, ...fam.weights])] } : { ...fam },
      );
    }
    styles.push({ ...style });
  }
  const order = scans[0]?.typography.styles.map((s) => s.role) ?? [];
  styles.sort(
    (a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.role.localeCompare(b.role),
  );
  const first = scans[0] as DesignScan;
  return {
    families: [...families.values()],
    styles,
    baseSize: styles.find((s) => s.role === 'body')?.size ?? first.typography.baseSize,
    scaleRatio: first.typography.scaleRatio,
  };
}

function mergeSpacing(scans: DesignScan[], mult: number[]): DesignScan['spacing'] {
  const w = (get: (s: DesignScan) => number) =>
    scans.map((s, i) => ({ v: get(s), w: mult[i] ?? 1 })).filter((x) => x.v > 0);
  const baseUnit =
    weightedMode(w((s) => s.spacing.baseUnit)) ?? (scans[0] as DesignScan).spacing.baseUnit;
  const counts = new Map<number, number>();
  scans.forEach((s, i) => {
    for (const v of s.spacing.scale) counts.set(v, (counts.get(v) ?? 0) + (mult[i] ?? 1));
  });
  const scale = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 10)
    .map(([v]) => v)
    .sort((a, b) => a - b);
  return {
    baseUnit,
    scale,
    sectionPaddingY: Math.round(weightedMedian(w((s) => s.spacing.sectionPaddingY)) ?? 0),
    contentGap: Math.round(weightedMedian(w((s) => s.spacing.contentGap)) ?? baseUnit * 3),
  };
}

function mergeRadii(scans: DesignScan[], mult: number[]): DesignScan['radii'] {
  const hist = new Map<number, number>();
  scans.forEach((s, i) => {
    for (const r of s.radii.scale)
      hist.set(r.value, (hist.get(r.value) ?? 0) + r.weight * (mult[i] ?? 1));
  });
  const total = [...hist.values()].reduce((a, b) => a + b, 0) || 1;
  const scale = [...hist]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 8)
    .map(([value, wt]) => ({ value, weight: Math.round((wt / total) * 10000) / 10000 }));
  const pick = (k: 'button' | 'card' | 'input') => {
    const m = weightedMedian(
      scans.flatMap((s, i) =>
        s.radii[k] !== undefined ? [{ v: s.radii[k] as number, w: mult[i] ?? 1 }] : [],
      ),
    );
    return m === undefined ? undefined : Math.round(m);
  };
  const pillW = scans.reduce((a, s, i) => a + (s.radii.pillButtons ? (mult[i] ?? 1) : 0), 0);
  const allW = mult.reduce((a, b) => a + b, 0);
  const out: DesignScan['radii'] = { scale, pillButtons: pillW >= allW / 2 };
  const b = pick('button');
  const c = pick('card');
  const i = pick('input');
  if (b !== undefined) out.button = b;
  if (c !== undefined) out.card = c;
  if (i !== undefined) out.input = i;
  return out;
}

function mergeShadows(scans: DesignScan[], mult: number[]): DesignScan['shadows'] {
  const map = new Map<string, { weight: number; level: 1 | 2 | 3 }>();
  scans.forEach((s, i) => {
    for (const sh of s.shadows) {
      const cur = map.get(sh.css);
      if (cur) cur.weight += sh.weight * (mult[i] ?? 1);
      else map.set(sh.css, { weight: sh.weight * (mult[i] ?? 1), level: sh.level });
    }
  });
  const total = [...map.values()].reduce((a, b) => a + b.weight, 0) || 1;
  return [...map]
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 8)
    .map(([css, v]) => ({
      css,
      level: v.level,
      weight: Math.round((v.weight / total) * 10000) / 10000,
    }));
}

function mergeBorders(scans: DesignScan[], mult: number[]): DesignScan['borders'] {
  const map = new Map<string, DesignScan['borders'][number]>();
  scans.forEach((s, i) => {
    for (const b of s.borders) {
      const key = `${b.width}|${b.colorRole ?? ''}`;
      const cur = map.get(key);
      if (cur) cur.weight += b.weight * (mult[i] ?? 1);
      else map.set(key, { ...b, weight: b.weight * (mult[i] ?? 1) });
    }
  });
  const total = [...map.values()].reduce((a, b) => a + b.weight, 0) || 1;
  return [...map.values()]
    .sort((a, b) => b.weight - a.weight)
    .map((b) => ({ ...b, weight: Math.round((b.weight / total) * 10000) / 10000 }));
}

/**
 * Merge scans of several pages of one site (ARCHITECTURE §5). Colors are re-clustered from the
 * summed weights; type styles keep the heavier style per role; spacing and radii use weighted
 * statistics; the blueprint is the first page's; `meta.pages` lists every URL. A scan that is
 * itself a merge counts once per page it covers, so merging page by page stays fair.
 */
export function mergeScans(scans: DesignScan[]): DesignScan {
  const first = scans[0];
  if (!first) throw new Error('mergeScans needs at least one scan');
  if (scans.length === 1) return first;
  const mult = scans.map(pagesOf);

  const colors = mergeColors(scans, mult);
  const typography = mergeTypography(scans, mult);
  const spacing = mergeSpacing(scans, mult);
  const radii = mergeRadii(scans, mult);

  const container = weightedMode(
    scans.flatMap((s, i) =>
      s.layout.containerMaxWidth !== null
        ? [{ v: s.layout.containerMaxWidth, w: mult[i] ?? 1 }]
        : [],
    ),
  );
  const gutter = weightedMedian(
    scans.flatMap((s, i) =>
      s.layout.gutter !== null ? [{ v: s.layout.gutter, w: mult[i] ?? 1 }] : [],
    ),
  );
  const bps = new Map<number, number>();
  scans.forEach((s, i) => {
    for (const b of s.layout.breakpoints) bps.set(b, (bps.get(b) ?? 0) + (mult[i] ?? 1));
  });

  const pages = [...new Set(scans.flatMap((s) => s.meta.pages ?? [s.url]))];
  const components = first.components ?? scans.find((s) => s.components)?.components;
  const variants = first.variants ?? scans.find((s) => s.variants)?.variants;
  const cssVariables: Record<string, string> = {};
  for (const s of [...scans].reverse()) Object.assign(cssVariables, s.cssVariables);

  const out: DesignScan = {
    schemaVersion: 3,
    id: first.id,
    url: first.url,
    host: first.host,
    title: first.title,
    scannedAt: Math.max(...scans.map((s) => s.scannedAt)),
    viewport: first.viewport,
    colorScheme: first.colorScheme,
    colors,
    typography,
    spacing,
    radii,
    shadows: mergeShadows(scans, mult),
    borders: mergeBorders(scans, mult),
    layout: {
      containerMaxWidth: container ?? null,
      gutter: gutter && gutter > 0 ? gutter : null,
      breakpoints: [...bps]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 5)
        .map(([v]) => v)
        .sort((a, b) => a - b),
      density: densityOf(spacing.sectionPaddingY, typography.baseSize),
      blueprint: first.layout.blueprint,
    },
    cssVariables,
    meta: {
      extractorVersion: first.meta.extractorVersion,
      sampleCount: scans.reduce((a, s) => a + s.meta.sampleCount, 0),
      durationMs: scans.reduce((a, s) => a + s.meta.durationMs, 0),
      warnings: [...new Set(scans.flatMap((s) => s.meta.warnings))],
      pages,
    },
  };
  if (first.motion) out.motion = first.motion;
  if (components) out.components = components;
  if (variants) out.variants = variants;
  if (first.vibe) out.vibe = first.vibe;
  out.a11y = computeA11y(colors);
  return DesignScanSchema.parse(out);
}
