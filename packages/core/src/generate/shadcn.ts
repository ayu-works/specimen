import { toOklch } from '../color';
import type { DesignScan } from '../schema';
import { firstHex, type GeneratedFile, oklchCss, primaryRadius, rem, themeVariant } from './common';

const DEFAULT_DANGER = '#ef4444';

function ok(hex: string): string {
  const [l, c, h] = toOklch(hex);
  const alpha = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
  return oklchCss(l, c, h, alpha);
}

function shadcnVars(scan: DesignScan): [string, string][] {
  const bg = firstHex(scan, 'background') ?? '#ffffff';
  const text = firstHex(scan, 'textPrimary') ?? '#111111';
  const surface = firstHex(scan, 'surface', 'surfaceAlt') ?? bg;
  const accent = firstHex(scan, 'accent') ?? text;
  const lightAccent = toOklch(accent)[0] > 0.65;
  const onAccent = firstHex(scan, 'accentForeground') ?? (lightAccent ? '#000000' : '#ffffff');
  const secondary = firstHex(scan, 'surfaceAlt', 'surface') ?? bg;
  const muted = firstHex(scan, 'surface', 'surfaceAlt') ?? bg;
  const mutedFg = firstHex(scan, 'textMuted', 'textSecondary') ?? text;
  const border = firstHex(scan, 'border', 'surfaceAlt') ?? muted;
  return [
    ['background', bg],
    ['foreground', text],
    ['card', surface],
    ['card-foreground', text],
    ['popover', surface],
    ['popover-foreground', text],
    ['primary', accent],
    ['primary-foreground', onAccent],
    ['secondary', secondary],
    ['secondary-foreground', text],
    ['muted', muted],
    ['muted-foreground', mutedFg],
    ['accent', secondary],
    ['accent-foreground', text],
    ['destructive', firstHex(scan, 'danger') ?? DEFAULT_DANGER],
    ['border', border],
    ['input', border],
    ['ring', accent],
  ];
}

/** shadcn/ui theme variables in oklch (roles mapped onto shadcn names; `.dark`/`.light` for a counterpart theme). */
export function generateShadcn(scan: DesignScan): GeneratedFile {
  const vars = shadcnVars(scan);
  const lines = [':root {', ...vars.map(([k, v]) => `  --${k}: ${ok(v)};`)];
  const r = primaryRadius(scan);
  lines.push(`  --radius: ${r >= 9999 ? '9999px' : rem(r)};`, '}');
  const variant = themeVariant(scan);
  if (variant) {
    const themed = { ...scan, colors: { ...scan.colors, ...variant.colors } };
    lines.push('', `.${variant.scheme} {`);
    for (const [k, v] of shadcnVars(themed)) lines.push(`  --${k}: ${ok(v)};`);
    lines.push('}');
  }
  return { filename: 'shadcn-theme.css', mime: 'text/css', content: `${lines.join('\n')}\n` };
}
