import { contrast, ensureContrast, toOklch } from '../color';
import { type ColorRole, type ColorToken, type DesignScan, DesignScanSchema } from '../schema';

export const FACETS = ['colors', 'typography', 'spacing', 'shape', 'layout'] as const;
/** `shape` = radii + shadows + borders. */
export type Facet = (typeof FACETS)[number];

export const FACET_LABELS: Record<Facet, string> = {
  colors: 'Colors',
  typography: 'Type',
  spacing: 'Spacing',
  shape: 'Shape',
  layout: 'Layout',
};

export interface ComposeOptions {
  id?: string;
}

const clone = <T>(v: T): T => structuredClone(v);

function roleHex(colors: DesignScan['colors'], role: ColorRole): string | undefined {
  const id = colors.roles[role];
  return id ? colors.palette.find((t) => t.id === id)?.hex : undefined;
}

/** Replace the color of one role with a new palette token. */
function setRole(colors: DesignScan['colors'], role: ColorRole, hex: string): void {
  const [l, c, h] = toOklch(hex);
  const tok: ColorToken = {
    id: `composed-${role}`,
    hex,
    oklch: [l, c, h],
    alpha: 1,
    weight: 0,
    usage: { bg: 0, text: 0, border: 0, fill: 0 },
  };
  colors.palette = [...colors.palette.filter((t) => t.id !== tok.id), tok];
  colors.roles[role] = tok.id;
}

/** Raise contrast of `fg` role on `bg` role to `min`, recording what changed. */
function fix(
  colors: DesignScan['colors'],
  fg: ColorRole,
  bg: ColorRole,
  min: number,
  warnings: string[],
): void {
  const fgHex = roleHex(colors, fg);
  const bgHex = roleHex(colors, bg);
  if (!fgHex || !bgHex) return;
  if (contrast(fgHex, bgHex) >= min) return;
  const res = ensureContrast(fgHex, bgHex, min);
  if (!res.changed) return;
  setRole(colors, fg, res.hex);
  warnings.push(
    `Adjusted ${fg} ${fgHex} → ${res.hex} for ${min >= 4.5 ? 'AA' : 'large-text AA'} contrast`,
  );
}

const PHRASE: Record<Facet, string> = {
  colors: 'colors',
  typography: 'type',
  spacing: 'spacing',
  shape: 'shape',
  layout: 'layout',
};

/**
 * Mix facets from different scans. Each facet comes from its source, else from `base`.
 * Colors are contrast-repaired afterwards (every change is recorded in `meta.warnings`).
 */
export function compose(
  sources: Partial<Record<Facet, DesignScan>>,
  base: DesignScan,
  opts: ComposeOptions = {},
): DesignScan {
  const pick = (f: Facet) => sources[f] ?? base;
  const colorSrc = pick('colors');
  const shapeSrc = pick('shape');

  const colors = clone(colorSrc.colors);
  const warnings: string[] = [];
  fix(colors, 'textPrimary', 'background', 4.5, warnings);
  fix(colors, 'textSecondary', 'background', 3, warnings);
  fix(colors, 'accentForeground', 'accent', 4.5, warnings);

  const mixed = FACETS.filter((f) => sources[f] && sources[f]?.id !== base.id);
  const title =
    mixed.length > 0
      ? `Composed: ${mixed.map((f) => `${PHRASE[f]} from ${sources[f]?.host}`).join(', ')}`
      : `Composed: ${base.host}`;
  const pages = [
    ...new Set([base, ...FACETS.map((f) => sources[f])].flatMap((s) => (s?.url ? [s.url] : []))),
  ];

  const out: DesignScan = {
    schemaVersion: 3,
    id: opts.id ?? `composed-${globalThis.crypto.randomUUID()}`,
    url: base.url,
    host: 'composed',
    title,
    scannedAt: Date.now(),
    viewport: clone(base.viewport),
    colorScheme: colorSrc.colorScheme,
    colors,
    typography: clone(pick('typography').typography),
    spacing: clone(pick('spacing').spacing),
    radii: clone(shapeSrc.radii),
    shadows: clone(shapeSrc.shadows),
    borders: clone(shapeSrc.borders),
    layout: clone(pick('layout').layout),
    cssVariables: {},
    meta: {
      extractorVersion: base.meta.extractorVersion,
      sampleCount: base.meta.sampleCount,
      durationMs: 0,
      warnings,
      pages,
    },
  };
  if (colorSrc.variants?.dark || colorSrc.variants?.light) {
    out.variants = {
      ...(colorSrc.variants.dark ? { dark: clone(colorSrc.variants.dark) } : {}),
      ...(colorSrc.variants.light ? { light: clone(colorSrc.variants.light) } : {}),
    };
  }
  return DesignScanSchema.parse(out);
}
