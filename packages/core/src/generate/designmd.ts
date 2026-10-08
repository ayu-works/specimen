import { pairLevel } from '../a11y';
import type { DesignScan } from '../schema';
import { describeSection, usableSections } from './blueprint';
import {
  breakpoints,
  extraPalette,
  fmt,
  type GeneratedFile,
  levelShadows,
  orderedStyles,
  px,
  ROLE_USAGE,
  radiusText,
  roleColors,
  table,
  themeVariant,
} from './common';
import { COMPONENT_LABELS, describeBase, describeProps } from './components';
import { visualDirection } from './direction';
import { type FontInfo, fontPhrase, fontSet } from './fonts';
import { mobileSection } from './mobile';
import { brandTokens, containsBrand, sanitize } from './sanitize';

const pct = (w: number) => `${fmt(w * 100, 1)}%`;

function hexToOk(
  hex: string,
  scan: DesignScan,
  colors: { palette?: DesignScan['colors']['palette'] } = scan.colors,
): string {
  const t = (colors.palette ?? scan.colors.palette).find((p) => p.hex === hex);
  if (!t) return '';
  const [l, c, h] = t.oklch;
  return `oklch(${fmt(l, 3)} ${fmt(c, 3)} ${fmt(c < 0.0005 ? 0 : h, 1)})`;
}

/** Full reference document: tables for every facet. Brand-free (ethics guardrail). */
export function generateDesignMd(scan: DesignScan): GeneratedFile {
  const fonts = fontSet(scan);
  const out: string[] = ['# DESIGN.md', '', '## Overview', '', visualDirection(scan)];

  // Colors
  const roles = roleColors(scan);
  out.push(
    '',
    '## Colors',
    '',
    table(
      ['Role', 'Hex', 'OKLCH', 'Weight', 'Usage'],
      roles.map(({ role, token }) => [
        role,
        token.hex,
        hexToOk(token.hex, scan),
        pct(token.weight),
        ROLE_USAGE[role],
      ]),
    ),
  );
  out.push(
    '',
    '### Palette',
    '',
    table(
      ['Token', 'Hex', 'OKLCH', 'Weight', 'Background', 'Text', 'Border'],
      [...scan.colors.palette]
        .sort((a, b) => b.weight - a.weight)
        .map((t) => [
          t.id,
          t.hex,
          hexToOk(t.hex, scan),
          pct(t.weight),
          pct(t.usage.bg),
          pct(t.usage.text),
          pct(t.usage.border),
        ]),
    ),
  );
  const extras = extraPalette(scan);
  if (extras.length > 0) {
    out.push('', `Colors not assigned to a role: ${extras.map((t) => t.hex).join(', ')}.`);
  }
  if (scan.colors.gradients.length > 0) {
    out.push(
      '',
      '### Gradients',
      '',
      table(
        ['Weight', 'CSS'],
        scan.colors.gradients.slice(0, 6).map((g) => [pct(g.weight), `\`${g.css}\``]),
      ),
    );
  }

  const variant = themeVariant(scan);
  if (variant) {
    const vrows = roleColors(scan, variant.colors);
    if (vrows.length > 0) {
      out.push(
        '',
        `## ${variant.scheme === 'dark' ? 'Dark' : 'Light'} theme`,
        '',
        `Counterpart palette for \`[data-theme="${variant.scheme}"]\`${variant.colors.measured ? ' (measured from the site).' : ' (derived, not measured).'}`,
        '',
        table(
          ['Role', 'Hex', 'OKLCH'],
          vrows.map(({ role, token }) => [
            role,
            token.hex,
            hexToOk(token.hex, scan, variant.colors),
          ]),
        ),
      );
    }
  }

  // Typography
  const famEntries: [string, FontInfo][] = [
    ['Display', fonts.display],
    ['Body', fonts.body],
  ];
  if (fonts.mono) famEntries.push(['Mono', fonts.mono]);
  const famRows = famEntries.map(([role, f]) => [role, fontPhrase(f), `\`${f.stack}\``]);
  out.push('', '## Typography', '', table(['Use', 'Family', 'Stack'], famRows));
  out.push(
    '',
    table(
      ['Role', 'Size (px)', 'Weight', 'Line height', 'Letter spacing', 'Transform'],
      orderedStyles(scan).map((s) => [
        s.role,
        s.size,
        s.weight,
        fmt(s.lineHeight),
        `${fmt(s.letterSpacingEm, 3)}em`,
        s.transform ?? 'none',
      ]),
    ),
    '',
    `Base size ${px(scan.typography.baseSize)}${scan.typography.scaleRatio ? `, scale ratio ${fmt(scan.typography.scaleRatio)}` : ''}.`,
  );

  // Spacing
  const sp = scan.spacing;
  out.push(
    '',
    '## Spacing',
    '',
    table(
      ['Property', 'Value'],
      [
        ['Base unit', px(sp.baseUnit)],
        ['Scale', sp.scale.map((v) => `${v}`).join(', ')],
        ['Section vertical padding', px(sp.sectionPaddingY)],
        ['Content gap', px(sp.contentGap)],
        ['Density', scan.layout.density],
      ],
    ),
  );

  // Radii
  out.push(
    '',
    '## Radii',
    '',
    table(
      ['Radius', 'Weight'],
      scan.radii.scale.map((r) => [radiusText(r.value), pct(r.weight)]),
    ),
    '',
    table(
      ['Component', 'Radius'],
      [
        ['Button', scan.radii.button !== undefined ? radiusText(scan.radii.button) : 'n/a'],
        ['Card', scan.radii.card !== undefined ? radiusText(scan.radii.card) : 'n/a'],
        ['Input', scan.radii.input !== undefined ? radiusText(scan.radii.input) : 'n/a'],
        ['Pill buttons', scan.radii.pillButtons ? 'yes' : 'no'],
      ],
    ),
  );

  // Shadows
  out.push('', '## Shadows', '');
  if (scan.shadows.length === 0) out.push('No shadows detected.');
  else {
    out.push(
      table(
        ['Level', 'Weight', 'CSS'],
        [...scan.shadows]
          .sort((a, b) => a.level - b.level || b.weight - a.weight)
          .map((s) => [s.level, pct(s.weight), `\`${s.css}\``]),
      ),
    );
    const main = levelShadows(scan);
    if (main.length > 0) {
      out.push('', `Primary shadow per level: ${main.map((m) => `L${m.level}`).join(', ')}.`);
    }
  }

  // Borders
  out.push('', '## Borders', '');
  if (scan.borders.length === 0) out.push('No borders detected.');
  else {
    out.push(
      table(
        ['Width', 'Color role', 'Weight'],
        scan.borders.map((b) => [px(b.width), b.colorRole ?? 'unassigned', pct(b.weight)]),
      ),
    );
  }

  // Layout
  const l = scan.layout;
  out.push(
    '',
    '## Layout',
    '',
    table(
      ['Property', 'Value'],
      [
        ['Container max-width', l.containerMaxWidth ? px(l.containerMaxWidth) : 'fluid'],
        ['Gutter', l.gutter ? px(l.gutter) : 'n/a'],
        [
          'Breakpoints',
          breakpoints(scan)
            .map((b) => `${b.name} ${px(b.px)}`)
            .join(', ') || 'n/a',
        ],
      ],
    ),
  );
  const sections = usableSections(scan, 20);
  out.push('', '### Section blueprint', '');
  out.push(
    ...(sections.length > 0
      ? sections.map((s, i) => `${i + 1}. ${describeSection(s)}`)
      : ['No sections detected.']),
  );

  // Mobile
  const mobile = mobileSection(scan, '## Mobile (≤ 390px)');
  if (mobile) out.push('', mobile);

  // Components
  out.push('', '## Components', '');
  if (scan.components && scan.components.length > 0) {
    out.push(
      table(
        ['Component', 'Base styles'],
        scan.components.map((c) => [COMPONENT_LABELS[c.kind], describeBase(c.base)]),
      ),
    );
    const stateRows = scan.components.flatMap((c) =>
      Object.entries(c.states).flatMap(([state, props]) =>
        props && Object.keys(props).length > 0
          ? [[COMPONENT_LABELS[c.kind], state, describeProps(props)]]
          : [],
      ),
    );
    if (stateRows.length > 0) {
      out.push(
        '',
        '### Interaction states',
        '',
        table(['Component', 'State', 'Changes'], stateRows),
      );
    }
  } else {
    out.push(
      'No component specs captured. Derive buttons, cards and inputs from the color, radius and spacing tables above.',
    );
  }

  // Accessibility
  const pairs = scan.a11y?.pairs ?? [];
  if (pairs.length > 0) {
    const label = { aa: 'AA', 'aa-large': 'AA large text only', fail: 'Fail' } as const;
    out.push(
      '',
      '## Accessibility',
      '',
      `${pairs.filter((p) => p.aa).length} of ${pairs.length} color pairs pass WCAG AA (4.5:1 text, 3:1 UI components).`,
      '',
      table(
        ['Foreground', 'Background', 'Ratio', 'Result', 'Suggested fix'],
        pairs.map((p) => [
          `${p.fgRole ?? 'fg'} ${p.fg}`,
          `${p.bgRole ?? 'bg'} ${p.bg}`,
          `${fmt(p.ratio, 2)}:1`,
          label[pairLevel(p)],
          p.fix ? p.fix : p.aa ? 'none needed' : 'n/a',
        ]),
      ),
    );
  }

  // CSS variables
  const tokens = brandTokens(scan);
  const vars = Object.entries(scan.cssVariables)
    .filter(([k, v]) => !containsBrand(k, tokens) && !containsBrand(v, tokens))
    .slice(0, 40);
  if (vars.length > 0) {
    out.push(
      '',
      '## CSS variables',
      '',
      table(
        ['Name', 'Value'],
        vars.map(([k, v]) => [`\`${k}\``, `\`${v}\``]),
      ),
    );
  }

  out.push(
    '',
    '---',
    '',
    'Generated by Specimen (open source). Values measured from a live page; use as inspiration, not for copying.',
  );
  return {
    filename: 'DESIGN.md',
    mime: 'text/markdown',
    content: `${sanitize(out.join('\n'), scan)}\n`,
  };
}
