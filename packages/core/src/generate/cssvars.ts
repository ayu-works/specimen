import type { DesignScan } from '../schema';
import { type GeneratedFile, kebab, px, roleColors, themeVariant } from './common';
import { flattenTokens } from './tokens';

/** `:root` custom properties (+ `[data-theme="dark|light"]` when a counterpart theme is present). */
export function generateCssVars(scan: DesignScan): GeneratedFile {
  const t = flattenTokens(scan);
  const lines: string[] = [':root {'];
  for (const c of t.colors) lines.push(`  --color-${c.name}: ${c.hex};`);
  lines.push('');
  lines.push(`  --font-display: ${t.fonts.display};`);
  lines.push(`  --font-body: ${t.fonts.body};`);
  if (t.fonts.mono) lines.push(`  --font-mono: ${t.fonts.mono};`);
  lines.push('');
  for (const s of t.text) {
    lines.push(`  --text-${s.name}: ${px(s.size)};`);
    lines.push(`  --text-${s.name}--line-height: ${s.lineHeight};`);
    lines.push(`  --text-${s.name}--letter-spacing: ${s.letterSpacingEm}em;`);
    lines.push(`  --text-${s.name}--weight: ${s.weight};`);
  }
  lines.push('');
  t.space.forEach((v, i) => {
    lines.push(`  --space-${i + 1}: ${px(v)};`);
  });
  lines.push('');
  for (const r of t.radii) lines.push(`  --radius-${r.name}: ${r.css};`);
  for (const s of t.shadows) lines.push(`  --shadow-${s.level}: ${s.css};`);
  lines.push('}');

  const variant = themeVariant(scan);
  if (variant) {
    const rows = roleColors(scan, variant.colors);
    if (rows.length > 0) {
      lines.push('', `[data-theme="${variant.scheme}"] {`);
      for (const { role, token } of rows) lines.push(`  --color-${kebab(role)}: ${token.hex};`);
      lines.push('}');
    }
  }
  return { filename: 'tokens.css', mime: 'text/css', content: `${lines.join('\n')}\n` };
}
