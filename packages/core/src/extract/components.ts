import { parseColor, toHex } from '../color';
import type { ComponentSpec, RawComponent } from '../schema';

type State = keyof ComponentSpec['states'];
const STATES: State[] = ['hover', 'focus', 'active', 'disabled'];
const KINDS: ComponentSpec['kind'][] = [
  'button-primary',
  'button-secondary',
  'button-ghost',
  'input',
  'card',
  'nav-link',
  'badge',
];
const COLOR_PROPS = new Set([
  'background-color',
  'color',
  'border-color',
  'outline-color',
  'text-decoration-color',
]);

/** Hex for any parseable CSS color; otherwise the value unchanged. Fully transparent → `transparent`. */
function normalizeColor(v: string): string {
  const c = parseColor(v);
  if (!c) return v.trim();
  if (c.alpha <= 0.004) return 'transparent';
  return toHex(c);
}

function normalize(prop: string, value: string): string | null {
  const v = value.replace(/\s*!important\s*$/i, '').trim();
  if (!v || v === 'initial' || v === 'inherit' || /var\(/.test(v)) return null;
  if (COLOR_PROPS.has(prop)) return normalizeColor(v);
  if (prop === 'font-size') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? `${Math.round(n * 10) / 10}px` : v;
  }
  return v;
}

/** `background` shorthand holding a plain color is the same as `background-color`. */
function canonical(prop: string, value: string): [string, string] | null {
  if (prop === 'background') {
    if (/gradient\(|url\(/.test(value)) return null;
    return ['background-color', value];
  }
  return [prop, value];
}

function modeOf(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bn = 0;
  for (const [v, n] of counts) {
    if (n > bn) {
      best = v;
      bn = n;
    }
  }
  return best;
}

/** Per property, the most common value across the representatives. */
function mergeProps(list: Record<string, string>[]): Record<string, string> {
  const by = new Map<string, string[]>();
  for (const rec of list) {
    for (const [k, raw] of Object.entries(rec)) {
      const c = canonical(k, raw);
      if (!c) continue;
      const val = normalize(c[0], c[1]);
      if (val === null) continue;
      by.set(c[0], [...(by.get(c[0]) ?? []), val]);
    }
  }
  const out: Record<string, string> = {};
  for (const [k, vals] of [...by].sort(([a], [b]) => a.localeCompare(b))) {
    const m = modeOf(vals);
    if (m !== undefined) out[k] = m;
  }
  return out;
}

/**
 * Raw representatives (several per kind) → one `ComponentSpec` per kind. Each property takes
 * its most common value; state rules that only repeat the base value are dropped.
 */
export function extractComponents(raw: RawComponent[] | undefined): ComponentSpec[] {
  if (!raw || raw.length === 0) return [];
  const out: ComponentSpec[] = [];
  for (const kind of KINDS) {
    const reps = raw.filter((r) => r.kind === kind);
    if (reps.length === 0) continue;
    const base = mergeProps(reps.map((r) => r.base));
    const states: ComponentSpec['states'] = {};
    for (const st of STATES) {
      const merged = mergeProps(reps.flatMap((r) => (r.states[st] ? [r.states[st]] : [])));
      const diff: Record<string, string> = {};
      for (const [k, v] of Object.entries(merged)) {
        if (base[k] !== v) diff[k] = v;
      }
      if (Object.keys(diff).length > 0) states[st] = diff;
    }
    out.push({ kind, base, states });
  }
  return out;
}
