import { contrast, ensureContrast, fromOklch, toOklch } from '../color';
import type { ColorRole, ColorToken, DesignScan } from '../schema';

type Colors = DesignScan['colors'];
export type Scheme = 'light' | 'dark';

const ZERO_USAGE = { bg: 0, text: 0, border: 0, fill: 0 };

function hexOf(colors: Colors, role: ColorRole): string | undefined {
  const id = colors.roles[role];
  return id ? colors.palette.find((t) => t.id === id)?.hex : undefined;
}

/** Scheme of a color set, from the lightness of its background role (light when unknown). */
export function detectScheme(colors: Colors): Scheme {
  const bg = hexOf(colors, 'background') ?? hexOf(colors, 'surface');
  if (!bg) return 'light';
  return toOklch(bg)[0] < 0.5 ? 'dark' : 'light';
}

/** Key under `scan.variants` that holds the opposite scheme of the scan's base colors. */
export function counterpartKey(scan: DesignScan): Scheme {
  return detectScheme(scan.colors) === 'light' ? 'dark' : 'light';
}

function token(id: string, hex: string): ColorToken {
  const [l, c, h] = toOklch(hex);
  return { id, hex, oklch: [l, c, h], alpha: 1, weight: 0, usage: { ...ZERO_USAGE } };
}

/**
 * Derive the opposite color scheme. Lightness is inverted around 0.5 with role-aware targets
 * (hue is kept, chroma roughly kept for accents), then contrast is enforced: text >= 7 where
 * possible, secondary text >= 4.5, accent >= 3 on the background, accent foreground >= 4.5.
 * Returns the full `colors` object (new palette tokens + roles) for `scan.variants.dark|light`.
 */
export function deriveCounterpart(colors: Colors): Colors {
  const toDark = detectScheme(colors) === 'light';
  const prefix = toDark ? 'dark' : 'light';
  const roles: Partial<Record<ColorRole, string>> = {};
  const palette: ColorToken[] = [];
  const out: Partial<Record<ColorRole, string>> = {};

  const src = (r: ColorRole) => hexOf(colors, r);
  const lch = (r: ColorRole): [number, number, number] | undefined => {
    const h = src(r);
    return h ? toOklch(h) : undefined;
  };
  const neutral = (r: ColorRole, l: number, maxC: number): string | undefined => {
    const o = lch(r);
    return o ? fromOklch(l, Math.min(o[1], maxC), o[2]) : undefined;
  };

  // Backgrounds and borders
  const bgSrc = lch('background') ?? lch('surface');
  const bgL = toDark ? 0.16 : 0.985;
  const bgHex = bgSrc ? fromOklch(bgL, Math.min(bgSrc[1], 0.025), bgSrc[2]) : fromOklch(bgL, 0, 0);
  out.background = bgHex;
  out.surface = neutral('surface', toDark ? 0.2 : 1, 0.025);
  out.surfaceAlt = neutral('surfaceAlt', toDark ? 0.245 : 0.95, 0.025);
  out.border = neutral('border', toDark ? 0.31 : 0.9, 0.025);

  // Text
  const fixText = (hex: string | undefined, min: number) =>
    hex ? ensureContrast(hex, bgHex, min).hex : undefined;
  out.textPrimary = fixText(neutral('textPrimary', toDark ? 0.96 : 0.2, 0.02), 7);
  out.textSecondary = fixText(neutral('textSecondary', toDark ? 0.78 : 0.4, 0.02), 4.5);
  out.textMuted = fixText(neutral('textMuted', toDark ? 0.64 : 0.52, 0.02), 3);

  // Accent family: stays vivid, must read at 3:1 on the new background.
  const accentSrc = lch('accent');
  let accentHex: string | undefined;
  if (accentSrc) {
    const [l, c, h] = accentSrc;
    const target = toDark ? Math.min(0.85, Math.max(0.62, l)) : Math.min(0.58, Math.max(0.4, l));
    accentHex = ensureContrast(fromOklch(target, c, h), bgHex, 3).hex;
    out.accent = accentHex;
    const [al, ac, ah] = toOklch(accentHex);
    out.accentHover = fromOklch(toDark ? Math.min(1, al + 0.05) : Math.max(0, al - 0.05), ac, ah);
  } else if (src('accentHover')) {
    out.accentHover = neutral('accentHover', toDark ? 0.72 : 0.45, 0.2);
  }
  if (src('accentForeground') || accentHex) {
    const base = accentHex ?? out.textPrimary ?? bgHex;
    const dark = '#0b0b0c';
    const light = '#fafafa';
    const pick = contrast(dark, base) >= contrast(light, base) ? dark : light;
    out.accentForeground = ensureContrast(pick, base, 4.5).hex;
  }
  const linkSrc = lch('link');
  if (linkSrc) {
    const [l, c, h] = linkSrc;
    const target = toDark ? Math.min(0.85, Math.max(0.7, l)) : Math.min(0.55, Math.max(0.4, l));
    out.link = ensureContrast(fromOklch(target, c, h), bgHex, 4.5).hex;
  }
  for (const r of ['success', 'warning', 'danger'] as const) {
    const o = lch(r);
    if (!o) continue;
    const target = toDark
      ? Math.min(0.8, Math.max(0.66, o[0]))
      : Math.min(0.62, Math.max(0.48, o[0]));
    out[r] = ensureContrast(fromOklch(target, o[1], o[2]), bgHex, 3).hex;
  }

  for (const [role, hex] of Object.entries(out) as [ColorRole, string | undefined][]) {
    if (!hex) continue;
    const t = token(`${prefix}-${role}`, hex);
    palette.push(t);
    roles[role] = t.id;
  }
  return { palette, roles, gradients: [] };
}

/** Counterpart colors for a scan: the stored variant when present, else derived. */
export function counterpartColors(scan: DesignScan): Colors {
  const stored = scan.variants?.[counterpartKey(scan)];
  if (stored?.roles && stored.palette) {
    return { palette: stored.palette, roles: stored.roles, gradients: stored.gradients ?? [] };
  }
  return deriveCounterpart(scan.colors);
}

/** The scan with its opposite-scheme variant attached (derived when missing). */
export function withCounterpart(scan: DesignScan): DesignScan {
  const key = counterpartKey(scan);
  if (scan.variants?.[key]?.roles) return scan;
  return { ...scan, variants: { ...scan.variants, [key]: deriveCounterpart(scan.colors) } };
}

/** The scan without any dark/light color variants (the base theme only). */
export function withoutThemeVariants(scan: DesignScan): DesignScan {
  if (!scan.variants?.dark && !scan.variants?.light) return scan;
  const { dark: _d, light: _l, ...rest } = scan.variants;
  return { ...scan, variants: Object.keys(rest).length > 0 ? rest : undefined };
}

/** True when the stored counterpart theme was measured from the page (not derived). */
export function hasMeasuredCounterpart(scan: DesignScan): boolean {
  const stored = scan.variants?.[counterpartKey(scan)];
  return Boolean(stored?.roles && stored.measured);
}
