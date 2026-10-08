import type { ColorToken } from '../schema/scan';
import { deltaE2000 } from './distance';
import { parseColor, type Rgba, toHex, toOklch } from './parse';

export type ColorUsage = 'bg' | 'text' | 'border' | 'fill';

export interface ColorEntry {
  color: string | Rgba;
  weight: number;
  usage: ColorUsage;
}

export interface ClusterOptions {
  neutralThreshold?: number;
  chromaticThreshold?: number;
  neutralChroma?: number;
  maxTokens?: number;
}

interface Cluster {
  rep: Rgba;
  repWeight: number;
  chroma: number;
  weight: number;
  usage: Record<ColorUsage, number>;
  firstIndex: number;
}

/**
 * Greedy weighted clustering. Entries are processed by descending weight; each joins the
 * first existing cluster within the ΔE2000 threshold (2.5 neutral, 4 chromatic), else
 * starts a new one. The cluster representative is its highest-weight member.
 */
export function clusterColors(entries: ColorEntry[], opts: ClusterOptions = {}): ColorToken[] {
  const neutralT = opts.neutralThreshold ?? 2.5;
  const chromaT = opts.chromaticThreshold ?? 4;
  const neutralChroma = opts.neutralChroma ?? 0.03;
  const maxTokens = opts.maxTokens ?? 24;

  const parsed = entries
    .map((e, i) => ({ rgba: typeof e.color === 'string' ? parseColor(e.color) : e.color, e, i }))
    .filter((p): p is { rgba: Rgba; e: ColorEntry; i: number } => p.rgba !== null && p.e.weight > 0)
    .sort((a, b) => b.e.weight - a.e.weight || a.i - b.i);

  const clusters: Cluster[] = [];
  for (const { rgba, e, i } of parsed) {
    const chroma = toOklch(rgba)[1];
    const threshold = chroma < neutralChroma ? neutralT : chromaT;
    let target: Cluster | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const c of clusters) {
      const d = deltaE2000(rgba, c.rep);
      if (d < threshold && d < best) {
        best = d;
        target = c;
      }
    }
    if (!target) {
      target = {
        rep: rgba,
        repWeight: e.weight,
        chroma,
        weight: 0,
        usage: { bg: 0, text: 0, border: 0, fill: 0 },
        firstIndex: i,
      };
      clusters.push(target);
    }
    target.weight += e.weight;
    target.usage[e.usage] += e.weight;
  }

  const kept = clusters
    .sort((a, b) => b.weight - a.weight || a.firstIndex - b.firstIndex)
    .slice(0, maxTokens);
  const total = kept.reduce((s, c) => s + c.weight, 0);
  if (total === 0) return [];

  return kept.map((c, idx) => ({
    id: `c${idx + 1}`,
    hex: toHex({ ...c.rep, alpha: 1 }),
    oklch: toOklch(c.rep),
    alpha: c.rep.alpha,
    weight: c.weight / total,
    usage: {
      bg: c.usage.bg / total,
      text: c.usage.text / total,
      border: c.usage.border / total,
      fill: c.usage.fill / total,
    },
  }));
}
