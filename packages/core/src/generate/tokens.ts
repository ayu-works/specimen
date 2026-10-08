import type { DesignScan } from '../schema';
import {
  breakpoints,
  cssRadius,
  extraPalette,
  familyByRole,
  kebab,
  levelShadows,
  orderedStyles,
  primaryRadius,
  roleColors,
} from './common';

export interface FlatTokens {
  colors: { name: string; hex: string }[];
  fonts: { display: string; body: string; mono?: string };
  text: {
    name: string;
    size: number;
    lineHeight: number;
    letterSpacingEm: number;
    weight: number;
  }[];
  baseUnit: number;
  space: number[];
  radii: { name: string; css: string; value: number }[];
  shadows: { level: 1 | 2 | 3; css: string }[];
  breakpoints: { name: string; px: number }[];
}

export const PALETTE_LIMIT = 12;

/** Normalised design tokens shared by the code-style exporters (CSS, Tailwind, DTCG, Figma). */
export function flattenTokens(scan: DesignScan): FlatTokens {
  const colors = roleColors(scan).map(({ role, token }) => ({ name: kebab(role), hex: token.hex }));
  extraPalette(scan, PALETTE_LIMIT).forEach((t, i) => {
    colors.push({ name: `palette-${i + 1}`, hex: t.hex });
  });
  const body = familyByRole(scan, 'body');
  const display = familyByRole(scan, 'display') ?? body;
  const mono = familyByRole(scan, 'mono');
  const bodyStack = body?.stack ?? 'system-ui, sans-serif';
  const radii: FlatTokens['radii'] = [];
  for (const k of ['button', 'card', 'input'] as const) {
    const v = scan.radii[k];
    if (v !== undefined) radii.push({ name: k, css: cssRadius(v), value: v });
  }
  if (radii.length === 0) {
    const v = primaryRadius(scan);
    radii.push({ name: 'default', css: cssRadius(v), value: v });
  }
  return {
    colors,
    fonts: { display: display?.stack ?? bodyStack, body: bodyStack, mono: mono?.stack },
    text: orderedStyles(scan).map((s) => ({
      name: s.role,
      size: s.size,
      lineHeight: s.lineHeight,
      letterSpacingEm: s.letterSpacingEm,
      weight: s.weight,
    })),
    baseUnit: scan.spacing.baseUnit,
    space: [...scan.spacing.scale],
    radii,
    shadows: levelShadows(scan),
    breakpoints: breakpoints(scan),
  };
}
