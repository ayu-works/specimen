import { parseColor, toHex, toOklch } from '../color/parse';
import { type DesignScan, DesignScanSchema, danglingRoles } from './scan';

/** The newest version this build understands. */
const CURRENT = 4;

const HEX = /^#[0-9a-f]{6}$/;

type Rec = Record<string, unknown>;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * v3 -> v4: v4 requires every palette `hex` to be `#rrggbb` and every role to point at a palette
 * id. Older rows are repaired rather than rejected: a hex culori can parse is normalised (and its
 * oklch recomputed), any other token is dropped, then roles pointing nowhere are dropped. Works on a
 * copy; anything that isn't shaped like a palette is left for the schema to reject.
 */
function repairColors(scan: Rec): Rec {
  let fixed = 0;
  let dropped = 0;
  let roles = 0;
  const fixPalette = (palette: unknown): unknown => {
    if (!Array.isArray(palette)) return palette;
    return palette.flatMap((t: unknown) => {
      if (!isRec(t) || typeof t.hex !== 'string' || HEX.test(t.hex)) return [t];
      const rgba = parseColor(t.hex);
      // A fully transparent value (`transparent`) isn't a color a role can use.
      if (!rgba || rgba.alpha === 0) {
        dropped++;
        return [];
      }
      const solid = { ...rgba, alpha: 1 };
      const alpha = typeof t.alpha === 'number' ? Math.min(t.alpha, rgba.alpha) : rgba.alpha;
      fixed++;
      return [{ ...t, hex: toHex(solid), oklch: toOklch(solid), alpha }];
    });
  };
  const fixRoles = (r: unknown, palette: unknown): unknown => {
    if (!isRec(r) || !Array.isArray(palette)) return r;
    const ids = palette.filter(isRec);
    const bad = new Set<string>(
      danglingRoles(r as Record<string, string>, ids as { id: string }[]),
    );
    roles += bad.size;
    return Object.fromEntries(Object.entries(r).filter(([k]) => !bad.has(k)));
  };

  // Shallow copies of only the parts repaired below; the rest is untrusted and left for zod to strip.
  const out: Rec = { ...scan };
  const colors = isRec(scan.colors) ? { ...scan.colors } : undefined;
  if (colors) {
    colors.palette = fixPalette(colors.palette);
    colors.roles = fixRoles(colors.roles, colors.palette);
    out.colors = colors;
  }
  if (isRec(scan.variants)) {
    const variants: Rec = { ...scan.variants };
    for (const key of ['dark', 'light']) {
      const src = variants[key];
      if (!isRec(src)) continue;
      const v = { ...src };
      if (v.palette !== undefined) v.palette = fixPalette(v.palette);
      v.roles = fixRoles(v.roles, v.palette ?? colors?.palette);
      variants[key] = v;
    }
    out.variants = variants;
  }
  const parts = [
    fixed > 0 && `normalised ${plural(fixed, 'color')}`,
    dropped > 0 && `dropped ${plural(dropped, 'unreadable color')}`,
    roles > 0 && `dropped ${plural(roles, 'role')} pointing at a missing color`,
  ].filter(Boolean);
  const meta = scan.meta;
  if (parts.length > 0 && isRec(meta) && Array.isArray(meta.warnings)) {
    out.meta = {
      ...meta,
      warnings: [...meta.warnings, `Repaired on upgrade: ${parts.join(', ')}.`],
    };
  }
  return out;
}

/**
 * Upgrade any stored/imported scan to the current schema version.
 *  - v1 -> v2: no-op; v2 only adds the optional `variants.light`.
 *  - v2 -> v3: no-op; v3 only adds optional fields (`variants.mobile` details, theme
 *    `measured` flag, richer `a11y` pairs).
 *  - v3 -> v4: `repairColors` (v4 enforces `#rrggbb` and roles that point at palette ids).
 * A v4 row that breaks those rules is rejected, not repaired. Unknown (newer) versions are rejected
 * with a clear message.
 */
export function migrate(input: unknown): DesignScan {
  let data = input;
  if (isRec(data)) {
    const v = data.schemaVersion;
    if (v === 1 || v === 2 || v === 3) data = { ...repairColors(data), schemaVersion: CURRENT };
    else if (typeof v === 'number' && v > CURRENT) {
      throw new Error(`Unsupported scan version ${v}; update Specimen.`);
    }
  }
  return DesignScanSchema.parse(data);
}
