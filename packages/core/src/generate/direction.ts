import { toOklch } from '../color';
import type { DesignScan } from '../schema';
import { firstHex, primaryRadius } from './common';
import { fontSet } from './fonts';

export function hueName(h: number): string {
  const x = ((h % 360) + 360) % 360;
  const table: [number, string][] = [
    [8, 'pink'],
    [42, 'red'],
    [65, 'orange'],
    [90, 'amber'],
    [110, 'yellow'],
    [135, 'lime'],
    [165, 'green'],
    [195, 'teal'],
    [230, 'cyan'],
    [265, 'blue'],
    [290, 'indigo'],
    [310, 'violet'],
    [335, 'purple'],
  ];
  for (const [max, name] of table) if (x < max) return name;
  return 'pink';
}

export type CornerStyle = 'sharp' | 'soft' | 'rounded' | 'pill';

export function cornerStyle(scan: DesignScan): CornerStyle {
  if (scan.radii.pillButtons) return 'pill';
  const r = primaryRadius(scan);
  if (r <= 2) return 'sharp';
  if (r <= 10) return 'soft';
  if (r <= 20) return 'rounded';
  return 'pill';
}

export function isDark(scan: DesignScan): boolean {
  const bg = firstHex(scan, 'background');
  if (bg) return toOklch(bg)[0] < 0.5;
  return scan.colorScheme === 'dark';
}

export function headingWeightName(scan: DesignScan): 'light' | 'regular' | 'bold' {
  const s =
    scan.typography.styles.find((t) => t.role === 'display') ??
    scan.typography.styles.find((t) => t.role === 'h1') ??
    scan.typography.styles.find((t) => t.role === 'h2');
  const w = s?.weight ?? 400;
  return w <= 300 ? 'light' : w >= 600 ? 'bold' : 'regular';
}

export function accentCharacter(
  scan: DesignScan,
): { hex: string; hue: string; tone: string } | null {
  const hex = firstHex(scan, 'accent');
  if (!hex) return null;
  const [, c, h] = toOklch(hex);
  if (c < 0.04) return null;
  return { hex, hue: hueName(h), tone: c >= 0.15 ? 'vivid' : 'muted' };
}

const DENSITY_PHRASE = {
  compact: 'compact, information-dense spacing',
  comfortable: 'balanced, comfortable spacing',
  airy: 'generous, airy spacing and large section padding',
} as const;

const KIND_WORD = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' } as const;

/** 2-3 deterministic sentences describing the look (plus the AI vibe summary, if any). */
export function visualDirection(scan: DesignScan): string {
  const dark = isDark(scan);
  const bg = firstHex(scan, 'background');
  const accent = accentCharacter(scan);
  const fonts = fontSet(scan);
  const corner = cornerStyle(scan);
  const r = primaryRadius(scan);

  const s1 = `A ${dark ? 'dark' : 'light'} interface${bg ? ` on a ${bg} background` : ''} with ${DENSITY_PHRASE[scan.layout.density]}.`;
  const s2 = accent
    ? `The accent is a ${accent.tone} ${accent.hue} (${accent.hex}) reserved for primary actions and highlights; everything else stays neutral.`
    : 'The palette is essentially monochrome, with no strong accent color: hierarchy comes from contrast and weight.';
  const cornerText =
    corner === 'pill'
      ? 'fully rounded, pill-shaped controls'
      : `${corner} corners (about ${r}px on buttons)`;
  const s3 = `Headlines use a ${KIND_WORD[fonts.display.kind]} display face in ${headingWeightName(scan)} weight, with ${cornerText}.`;
  const out = [s1, s2, s3];
  if (scan.vibe?.summary) out.push(scan.vibe.summary.trim());
  return out.join(' ');
}
