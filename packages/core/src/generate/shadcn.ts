import { toOklch } from '../color';
import type { DesignScan } from '../schema';
import { firstHex, type GeneratedFile, oklchCss, primaryRadius, rem } from './common';

const DEFAULT_DANGER = '#ef4444';

function ok(hex: string): string {
  const [l, c, h] = toOklch(hex);
  const alpha = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
  return oklchCss(l, c, h, alpha);
}

/** shadcn/ui theme variables in oklch (roles mapped onto shadcn names). */
export function generateShadcn(scan: DesignScan): GeneratedFile {
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
  const vars: [string, string][] = [
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
  const lines = [':root {', ...vars.map(([k, v]) => `  --${k}: ${ok(v)};`)];
  const r = primaryRadius(scan);
  lines.push(`  --radius: ${r >= 9999 ? '9999px' : rem(r)};`, '}');
  return { filename: 'shadcn-theme.css', mime: 'text/css', content: `${lines.join('\n')}\n` };
}
