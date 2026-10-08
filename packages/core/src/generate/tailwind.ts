import type { DesignScan } from '../schema';
import { fmt, type GeneratedFile, kebab, px, rem, roleColors, themeVariant } from './common';
import { flattenTokens } from './tokens';

/** Tailwind CSS v4: `@import "tailwindcss"` + `@theme { … }` (+ a `[data-theme]` block when a counterpart theme is present). */
export function generateTailwindV4(scan: DesignScan): GeneratedFile {
  const t = flattenTokens(scan);
  const l: string[] = ['@import "tailwindcss";', '', '@theme {'];
  for (const c of t.colors) l.push(`  --color-${c.name}: ${c.hex};`);
  l.push('');
  l.push(`  --font-display: ${t.fonts.display};`);
  l.push(`  --font-body: ${t.fonts.body};`);
  if (t.fonts.mono) l.push(`  --font-mono: ${t.fonts.mono};`);
  l.push('');
  for (const s of t.text) {
    l.push(`  --text-${s.name}: ${rem(s.size)};`);
    l.push(`  --text-${s.name}--line-height: ${s.lineHeight};`);
  }
  l.push('');
  // Tailwind multiplies --spacing by the utility number: p-4 = 4 * --spacing.
  l.push(`  --spacing: ${fmt(t.baseUnit / 16, 4)}rem;`);
  for (const r of t.radii) l.push(`  --radius-${r.name}: ${r.css};`);
  for (const s of t.shadows) l.push(`  --shadow-${s.level}: ${s.css};`);
  if (t.breakpoints.length > 0) l.push('');
  for (const b of t.breakpoints) l.push(`  --breakpoint-${b.name}: ${px(b.px)};`);
  l.push('}');
  const variant = themeVariant(scan);
  if (variant) {
    const rows = roleColors(scan, variant.colors);
    if (rows.length > 0) {
      const sel = `[data-theme="${variant.scheme}"]`;
      l.push('', `@custom-variant ${variant.scheme} (&:where(${sel}, ${sel} *));`);
      l.push('', `${sel} {`);
      for (const { role, token } of rows) l.push(`  --color-${kebab(role)}: ${token.hex};`);
      l.push('}');
    }
  }
  return { filename: 'tailwind.css', mime: 'text/css', content: `${l.join('\n')}\n` };
}

function quote(s: string): string {
  return JSON.stringify(s);
}

function obj(entries: [string, string][], indent: string): string {
  if (entries.length === 0) return '{}';
  const body = entries.map(([k, v]) => `${indent}  ${quote(k)}: ${v},`).join('\n');
  return `{\n${body}\n${indent}}`;
}

/** Tailwind CSS v3 `tailwind.config.js` (CommonJS, `theme.extend`). */
export function generateTailwindV3(scan: DesignScan): GeneratedFile {
  const t = flattenTokens(scan);
  const colors = obj(
    t.colors.map((c) => [c.name, quote(c.hex)]),
    '      ',
  );
  const fonts: [string, string][] = [
    ['display', quote(t.fonts.display)],
    ['body', quote(t.fonts.body)],
  ];
  if (t.fonts.mono) fonts.push(['mono', quote(t.fonts.mono)]);
  const fontSize = obj(
    t.text.map((s) => [
      s.name,
      `[${quote(rem(s.size))}, { lineHeight: ${quote(String(s.lineHeight))}, letterSpacing: ${quote(`${s.letterSpacingEm}em`)}, fontWeight: ${quote(String(s.weight))} }]`,
    ]),
    '      ',
  );
  const radius = obj(
    t.radii.map((r) => [r.name, quote(r.css)]),
    '      ',
  );
  const shadow = obj(
    t.shadows.map((s) => [String(s.level), quote(s.css)]),
    '      ',
  );
  const spacing = obj(
    t.space.map((v, i) => [String(i + 1), quote(px(v))]),
    '      ',
  );
  const screens = obj(
    t.breakpoints.map((b) => [b.name, quote(px(b.px))]),
    '      ',
  );
  const content = `/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: ${colors},
      fontFamily: ${obj(fonts, '      ')},
      fontSize: ${fontSize},
      borderRadius: ${radius},
      boxShadow: ${shadow},
      spacing: ${spacing},
      screens: ${screens},
    },
  },
};
`;
  return { filename: 'tailwind.config.js', mime: 'text/javascript', content };
}
