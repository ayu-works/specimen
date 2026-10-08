import { contrast, ensureContrast } from '../color';
import type { ColorRole, DesignScan } from '../schema';

type Colors = DesignScan['colors'];
export type A11yPair = NonNullable<DesignScan['a11y']>['pairs'][number];
export type A11yLevel = 'aa' | 'aa-large' | 'fail';

/** Text pairs: each foreground role is checked on `background` and `surface`. */
const TEXT_ROLES: ColorRole[] = ['textPrimary', 'textSecondary', 'textMuted', 'link'];
const SURFACES: ColorRole[] = ['background', 'surface'];

const AA_TEXT = 4.5;
const AA_LARGE = 3;
const AA_UI = 3;

function hexOf(colors: Colors, role: ColorRole): string | undefined {
  const id = colors.roles[role];
  return id ? colors.palette.find((t) => t.id === id)?.hex : undefined;
}

function pair(
  colors: Colors,
  fgRole: ColorRole,
  bgRole: ColorRole,
  kind: 'text' | 'ui',
): A11yPair | null {
  const fg = hexOf(colors, fgRole);
  const bg = hexOf(colors, bgRole);
  if (!fg || !bg || fg === bg) return null;
  const ratio = Math.round(contrast(fg, bg) * 100) / 100;
  const required = kind === 'ui' ? AA_UI : AA_TEXT;
  const out: A11yPair = {
    fg,
    bg,
    ratio,
    aa: ratio >= required,
    aaLarge: ratio >= AA_LARGE,
    fgRole,
    bgRole,
    kind,
  };
  if (!out.aa) {
    const res = ensureContrast(fg, bg, required);
    if (res.changed && res.ratio >= required) out.fix = res.hex;
  }
  return out;
}

/**
 * Contrast matrix for the roles that matter: text roles and links on background and
 * surface, accent foreground on accent, and the border on background at 3:1 (UI component).
 */
export function computeA11y(colors: Colors): NonNullable<DesignScan['a11y']> {
  const pairs: A11yPair[] = [];
  for (const bg of SURFACES) {
    for (const fg of TEXT_ROLES) {
      const p = pair(colors, fg, bg, 'text');
      if (p) pairs.push(p);
    }
  }
  const onAccent = pair(colors, 'accentForeground', 'accent', 'text');
  if (onAccent) pairs.push(onAccent);
  const border = pair(colors, 'border', 'background', 'ui');
  if (border) pairs.push(border);
  return { pairs };
}

export function pairLevel(p: A11yPair): A11yLevel {
  if (p.aa) return 'aa';
  return p.aaLarge && p.kind !== 'ui' ? 'aa-large' : 'fail';
}

export interface A11ySummary {
  total: number;
  passing: number;
  failing: A11yPair[];
}

/** "9 of 11 pairs pass AA", with the failing pairs (worst first). */
export function a11ySummary(scan: Pick<DesignScan, 'a11y'>): A11ySummary {
  const pairs = scan.a11y?.pairs ?? [];
  const failing = pairs.filter((p) => !p.aa).sort((a, b) => a.ratio - b.ratio);
  return { total: pairs.length, passing: pairs.length - failing.length, failing };
}

/**
 * Suggested replacement per failing text role (one fix per role: the one for its lowest
 * ratio). Borders are decorative on most sites, so they are not part of this list.
 */
export function a11yFixes(
  scan: Pick<DesignScan, 'a11y'>,
): { role: ColorRole; from: string; to: string }[] {
  const out = new Map<ColorRole, { role: ColorRole; from: string; to: string; ratio: number }>();
  for (const p of scan.a11y?.pairs ?? []) {
    if (p.aa || !p.fix || !p.fgRole || p.kind === 'ui') continue;
    const prev = out.get(p.fgRole);
    if (!prev || p.ratio < prev.ratio) {
      out.set(p.fgRole, { role: p.fgRole, from: p.fg, to: p.fix, ratio: p.ratio });
    }
  }
  return [...out.values()].map(({ role, from, to }) => ({ role, from, to }));
}
