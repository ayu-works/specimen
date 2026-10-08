import type { DesignScan, RawPage } from '../schema';
import { area, bump, ranked, round } from './util';

export type Shadows = DesignScan['shadows'];

/** Split a CSS list on top-level commas (not those inside rgba(...)). */
function splitLayers(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const num = (n: number) => (n === 0 ? '0' : `${round(n, 2)}px`);

interface Layer {
  css: string;
  blur: number;
}

/** `rgba(..) 0px 1px 2px 0px` -> `0 1px 2px rgba(..)` (zero spread dropped). */
function normalizeLayer(layer: string): Layer | null {
  const inset = /\binset\b/.test(layer);
  let rest = layer.replace(/\binset\b/, '').trim();
  const fn = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)/i.exec(rest);
  let color = fn?.[0];
  if (color) rest = rest.replace(color, ' ');
  else {
    const m = /#[0-9a-f]{3,8}\b|\b[a-z]+\b/i.exec(rest.replace(/-?\d*\.?\d+(px)?/g, ' '));
    color = m?.[0];
    if (color) rest = rest.replace(color, ' ');
  }
  const nums = [...rest.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
  if (!color || nums.length < 2) return null;
  const [x = 0, y = 0, blur = 0, spread = 0] = nums;
  const parts = [num(x), num(y), num(blur)];
  if (spread !== 0) parts.push(num(spread));
  return { css: `${inset ? 'inset ' : ''}${parts.join(' ')} ${color}`, blur };
}

export function normalizeShadow(v: string): { css: string; blur: number } | null {
  const layers = splitLayers(v)
    .map(normalizeLayer)
    .filter((l): l is Layer => l !== null);
  if (layers.length === 0) return null;
  return { css: layers.map((l) => l.css).join(', '), blur: Math.max(...layers.map((l) => l.blur)) };
}

const levelOf = (blur: number): 1 | 2 | 3 => (blur <= 4 ? 1 : blur <= 16 ? 2 : 3);

export function extractShadows(raw: RawPage): Shadows {
  const weights = new Map<string, number>();
  const blurs = new Map<string, number>();
  for (const s of raw.samples) {
    const v = s.s.boxShadow;
    if (!v || v === 'none') continue;
    const n = normalizeShadow(v);
    if (!n) continue;
    bump(weights, n.css, Math.sqrt(Math.max(area(s), 1)));
    blurs.set(n.css, n.blur);
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  return ranked(weights)
    .slice(0, 8)
    .map(([css, w]) => ({
      css,
      weight: round(w / total, 4),
      level: levelOf(blurs.get(css) ?? 0),
    }));
}
