import type { z } from 'zod';
import { BOUNDS, MAX } from './bounds';
import { type DesignScan, DesignScanSchema } from './scan';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  keyType?: z.ZodType;
  valueType?: z.ZodType;
}
const defOf = (s: z.ZodType) => (s as unknown as { _zod: { def: Def } })._zod.def;

/**
 * Cut `value` to the bounds the schema node declares (strings truncated, arrays and records keep
 * their first entries), recording each cut path. Containers are shallow-copied, never mutated;
 * keys the schema doesn't know are left for zod to strip.
 */
function walk(schema: z.ZodType, value: unknown, path: string, cut: Set<string>): unknown {
  const def = defOf(schema);
  const max = MAX.get(schema);
  switch (def.type) {
    case 'optional':
    case 'nullable':
      return def.innerType ? walk(def.innerType, value, path, cut) : value;
    case 'string':
      if (typeof value !== 'string' || max === undefined || value.length <= max) return value;
      cut.add(path);
      return value.slice(0, max);
    case 'array': {
      if (!Array.isArray(value) || !def.element) return value;
      let items = value;
      if (max !== undefined && items.length > max) {
        cut.add(path);
        items = items.slice(0, max);
      }
      const el = def.element;
      return items.map((v) => walk(el, v, `${path}[]`, cut));
    }
    case 'record': {
      if (!isRec(value) || !def.keyType || !def.valueType) return value;
      let entries = Object.entries(value);
      if (max !== undefined && entries.length > max) {
        cut.add(path);
        entries = entries.slice(0, max);
      }
      const { keyType, valueType } = def;
      return Object.fromEntries(
        entries.map(([k, v]) => [
          walk(keyType, k, path, cut),
          walk(valueType, v, `${path}.*`, cut),
        ]),
      );
    }
    case 'object': {
      if (!isRec(value) || !def.shape) return value;
      const out: Rec = { ...value };
      for (const [key, child] of Object.entries(def.shape)) {
        if (key in value) out[key] = walk(child, value[key], path ? `${path}.${key}` : key, cut);
      }
      return out;
    }
    default:
      return value;
  }
}

const idsOf = (palette: unknown): Set<unknown> =>
  new Set(Array.isArray(palette) ? palette.map((t) => (isRec(t) ? t.id : undefined)) : []);

/** Drop the roles that pointed at palette entries the trim removed (and only those). */
function dropCutRoles(before: Rec, after: Rec): number {
  let dropped = 0;
  const prune = (beforeColors: unknown, afterColors: unknown, basePalette?: [unknown, unknown]) => {
    if (!isRec(beforeColors) || !isRec(afterColors) || !isRec(afterColors.roles)) return;
    const [was, now] =
      afterColors.palette !== undefined
        ? [beforeColors.palette, afterColors.palette]
        : (basePalette ?? [undefined, undefined]);
    const kept = idsOf(now);
    const removed = [...idsOf(was)].filter((id) => !kept.has(id));
    if (removed.length === 0) return;
    const gone = new Set(removed);
    const roles = Object.entries(afterColors.roles).filter(([, id]) => !gone.has(id));
    dropped += Object.keys(afterColors.roles).length - roles.length;
    afterColors.roles = Object.fromEntries(roles);
  };
  const base = [
    isRec(before.colors) ? before.colors.palette : undefined,
    isRec(after.colors) ? after.colors.palette : undefined,
  ] as [unknown, unknown];
  prune(before.colors, after.colors);
  if (isRec(before.variants) && isRec(after.variants)) {
    for (const key of ['dark', 'light']) prune(before.variants[key], after.variants[key], base);
  }
  return dropped;
}

/**
 * Bring a scan-shaped value inside `BOUNDS`. With `warn`, a cut adds one "Trimmed on upgrade"
 * warning (used by `migrate` for older rows). Returns a copy; the input is never mutated.
 */
export function trimToBounds(input: Rec, warn: boolean): Rec {
  const cut = new Set<string>();
  const out = walk(DesignScanSchema, input, '', cut) as Rec;
  if (cut.size === 0) return out;
  const roles = dropCutRoles(input, out);
  if (warn && isRec(out.meta) && Array.isArray(out.meta.warnings)) {
    const what =
      [...cut].join(', ') + (roles > 0 ? `; dropped ${roles} role(s) pointing at cut colors` : '');
    const note = `Trimmed on upgrade: ${what}.`.slice(0, BOUNDS.warning);
    out.meta = {
      ...out.meta,
      warnings: [...out.meta.warnings.slice(0, BOUNDS.warnings - 1), note],
    };
  }
  return out;
}

/** Clamp a scan our own code built (merge, compose, extract) to the bounds, with no warning. */
export function clampToBounds(scan: DesignScan): DesignScan {
  return trimToBounds(scan as unknown as Rec, false) as unknown as DesignScan;
}
