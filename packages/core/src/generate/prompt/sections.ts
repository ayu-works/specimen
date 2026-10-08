import type { DesignScan } from '../../schema';
import { describeSection, usableSections } from '../blueprint';
import {
  breakpoints,
  extraPalette,
  firstHex,
  fmt,
  levelShadows,
  nearestSpace,
  orderedStyles,
  primaryRadius,
  px,
  ROLE_USAGE,
  radiusText,
  roleColors,
  table,
} from '../common';
import { cornerStyle, visualDirection } from '../direction';
import { type FontInfo, fontPhrase, fontSet } from '../fonts';

export function goal(): string {
  return [
    '## Goal',
    '',
    'Build a new, original web page/product UI using the visual system below. Match the look and feel through these exact values; do not copy any brand, logo, product name, or text from the source.',
  ].join('\n');
}

export function direction(scan: DesignScan): string {
  return ['## Visual direction', '', visualDirection(scan)].join('\n');
}

export function colorTokens(scan: DesignScan): string {
  const rows = roleColors(scan).map(({ role, token }) => [role, token.hex, ROLE_USAGE[role]]);
  const out = ['## Color tokens', '', table(['Role', 'Hex', 'Usage'], rows)];
  const extras = extraPalette(scan, 6);
  if (extras.length > 0) {
    out.push('', `Supporting colors: ${extras.map((t) => t.hex).join(', ')}.`);
  }
  return out.join('\n');
}

function fontLine(label: string, f: FontInfo): string {
  return `- ${label}: ${fontPhrase(f)}. Stack: \`${f.stack}\``;
}

export function typography(scan: DesignScan): string {
  const fonts = fontSet(scan);
  const lines = [fontLine('Headings', fonts.display)];
  if (fonts.body.stack !== fonts.display.stack || fonts.body.label !== fonts.display.label)
    lines.push(fontLine('Body', fonts.body));
  else lines[0] = fontLine('Headings and body', fonts.display);
  if (fonts.mono) lines.push(fontLine('Code and labels', fonts.mono));
  const rows = orderedStyles(scan).map((s) => [
    s.role,
    s.size,
    s.weight,
    fmt(s.lineHeight),
    `${fmt(s.letterSpacingEm, 3)}em`,
  ]);
  return [
    '## Typography',
    '',
    ...lines,
    '',
    table(['Role', 'Size (px)', 'Weight', 'Line height', 'Letter spacing'], rows),
  ].join('\n');
}

export function spacingShape(scan: DesignScan): string {
  const { spacing, radii } = scan;
  const lines = [
    `- Base unit: ${px(spacing.baseUnit)}. Scale: ${spacing.scale.map((v) => `${v}`).join(', ')} (px).`,
    `- Section vertical padding: ${px(spacing.sectionPaddingY)}. Gap between content blocks: ${px(spacing.contentGap)}.`,
  ];
  const r = [
    radii.button !== undefined ? `buttons ${radiusText(radii.button)}` : null,
    radii.card !== undefined ? `cards ${radiusText(radii.card)}` : null,
    radii.input !== undefined ? `inputs ${radiusText(radii.input)}` : null,
  ].filter(Boolean);
  if (r.length === 0) r.push(`default ${radiusText(primaryRadius(scan))}`);
  lines.push(`- Radii: ${r.join(', ')}.${radii.pillButtons ? ' Buttons are pill-shaped.' : ''}`);
  const shadows = levelShadows(scan);
  if (shadows.length > 0) {
    lines.push('- Shadows:');
    for (const s of shadows) lines.push(`  - Level ${s.level}: \`${s.css}\``);
  } else lines.push('- Shadows: none; rely on borders for separation.');
  const widths = [...new Set(scan.borders.map((b) => b.width))].sort((a, b) => a - b);
  lines.push(
    widths.length > 0
      ? `- Border widths: ${widths.map((w) => px(w)).join(', ')}.`
      : '- Border widths: avoid borders.',
  );
  return ['## Spacing & shape', '', ...lines].join('\n');
}

export function layout(scan: DesignScan): string {
  const { layout: l } = scan;
  const lines = [
    `- Container max-width: ${l.containerMaxWidth ? px(l.containerMaxWidth) : 'fluid'}, centered; horizontal gutter ${l.gutter ? px(l.gutter) : px(scan.spacing.baseUnit * 4)}.`,
  ];
  const bps = breakpoints(scan);
  if (bps.length > 0) lines.push(`- Breakpoints: ${bps.map((b) => px(b.px)).join(', ')}.`);
  const sections = usableSections(scan, 12);
  const numbered = sections.map((s, i) => `${i + 1}. ${describeSection(s)}`);
  return [
    '## Layout blueprint',
    '',
    ...lines,
    '',
    'Sections, top to bottom (use original placeholder copy):',
    ...(numbered.length > 0 ? numbered : ['1. hero, then content sections, then footer']),
  ].join('\n');
}

export function componentRules(scan: DesignScan): string {
  const accent = firstHex(scan, 'accent');
  const fg = firstHex(scan, 'accentForeground');
  const text = firstHex(scan, 'textPrimary');
  const border = firstHex(scan, 'border');
  const surface = firstHex(scan, 'surface', 'surfaceAlt', 'background');
  const bg = firstHex(scan, 'background');
  const link = firstHex(scan, 'link', 'accent');
  const radius = primaryRadius(scan);
  const btnStyle = scan.typography.styles.find((s) => s.role === 'button');
  const py = nearestSpace(scan, scan.spacing.baseUnit * 2.5);
  const pxx = nearestSpace(scan, scan.spacing.baseUnit * 5);
  const cardRadius = scan.radii.card ?? radius;
  const inputRadius = scan.radii.input ?? scan.radii.button ?? radius;
  const shadow = levelShadows(scan)[0];
  const btnFont = btnStyle ? `, ${btnStyle.size}px / weight ${btnStyle.weight}` : '';
  const bw = scan.borders[0]?.width ?? 1;
  const out = [
    '## Component rules',
    '',
    `- Primary button: background ${accent ?? text ?? 'textPrimary'}${accent ? ' (accent)' : ''}, text ${fg ?? bg ?? 'accentForeground'}, radius ${radiusText(radius)}, padding ${py}px ${pxx}px${btnFont}. Slightly darken or lighten on hover.`,
    `- Secondary button: transparent or ${surface ?? 'surface'} background, ${px(bw)} border in ${border ?? 'the border color'}, text ${text ?? 'textPrimary'}, same radius and padding as primary.`,
    `- Card: ${surface ?? 'surface'} background, ${px(bw)} border in ${border ?? 'the border color'}, radius ${radiusText(cardRadius)}, padding ${nearestSpace(scan, scan.spacing.baseUnit * 6)}px${shadow ? `, shadow \`${shadow.css}\`` : ', no shadow'}.`,
    `- Input: ${bg ?? 'background'} fill, ${px(bw)} border in ${border ?? 'the border color'}, radius ${radiusText(inputRadius)}, height about ${py * 2 + (btnStyle?.size ?? scan.typography.baseSize)}px; focus ring in ${accent ?? text ?? 'the text color'}.`,
    `- Links: ${link ?? text ?? 'the text color'}${link && !scan.colors.roles.link ? ' (accent)' : ''}, no underline at rest, underline or color shift on hover.`,
  ];
  if (cornerStyle(scan) === 'pill')
    out.push('- Keep every interactive control fully rounded (pill).');
  return out.join('\n');
}

export function doDont(): string {
  return [
    "## Do / Don't",
    '',
    '- Do use only the colors above; derive tints by opacity, not new hues.',
    '- Do use the type scale and weights exactly as listed.',
    '- Do keep spacing on the scale and radii consistent across components.',
    '- Do keep the accent for primary actions and key highlights.',
    "- Don't introduce new accent colors or extra font families.",
    "- Don't copy logos, names, or text from the source site; write original copy.",
  ].join('\n');
}
