import { describe, expect, it } from 'vitest';
import { a11yFixes, a11ySummary, computeA11y, pairLevel } from '../src/a11y';
import { contrast, toOklch } from '../src/color';
import { diffScans } from '../src/diff';
import { extract, mergeScans } from '../src/extract';
import { extractComponents } from '../src/extract/components';
import { generateFixPrompt } from '../src/generate';
import {
  type ColorRole,
  type ColorToken,
  type DesignScan,
  DesignScanSchema,
  type RawComponent,
} from '../src/schema';
import { ALL_NAMES, loadRaw, roleHex, scanOf } from './helpers';

/** Point `role` at a brand-new palette token with `hex`. */
function withRole(scan: DesignScan, role: ColorRole, hex: string): DesignScan {
  const out = structuredClone(scan);
  const [l, c, h] = toOklch(hex);
  const tok: ColorToken = {
    id: `t-${role}`,
    hex,
    oklch: [l, c, h],
    alpha: 1,
    weight: 0,
    usage: { bg: 0, text: 0, border: 0, fill: 0 },
  };
  out.colors.palette.push(tok);
  out.colors.roles[role] = tok.id;
  return out;
}

const rawComp = (
  kind: RawComponent['kind'],
  base: Record<string, string>,
  states: RawComponent['states'] = {},
): RawComponent => ({ kind, base, states });

describe('component detection', () => {
  const components: RawComponent[] = [
    rawComp(
      'button-primary',
      {
        'background-color': 'rgb(83, 58, 253)',
        color: 'rgb(255, 255, 255)',
        'border-radius': '6px',
        'font-size': '15.04px',
      },
      { hover: { 'background-color': '#4434d4' }, focus: { 'outline-color': 'rgb(83, 58, 253)' } },
    ),
    rawComp(
      'button-primary',
      {
        'background-color': 'rgb(83, 58, 253)',
        color: 'rgb(255, 255, 255)',
        'border-radius': '6px',
        'font-size': '15px',
      },
      { hover: { 'background-color': 'rgb(68, 52, 212)' } },
    ),
    rawComp('button-primary', {
      'background-color': 'rgb(0, 0, 0)',
      color: 'rgb(255, 255, 255)',
      'border-radius': '6px',
    }),
    rawComp('button-secondary', {
      'background-color': 'rgba(0, 0, 0, 0)',
      color: 'rgb(6, 27, 49)',
      'border-top-color': 'rgb(229, 237, 245)',
    }),
    rawComp(
      'input',
      { 'background-color': 'rgb(255, 255, 255)', 'border-radius': '4px', color: 'var(--fg)' },
      { focus: { 'border-color': '#533afd' } },
    ),
    rawComp('card', {
      'background-color': 'rgb(246, 249, 252)',
      'border-radius': '8px',
      'box-shadow': 'none',
    }),
  ];

  it('T5.01 finds primary/secondary button, input and card clusters from raw component data', () => {
    const specs = extractComponents(components);
    const kinds = specs.map((s) => s.kind);
    expect(kinds).toEqual(['button-primary', 'button-secondary', 'input', 'card']);
    const get = (k: string) => specs.find((s) => s.kind === k);

    const primary = get('button-primary');
    // Most common value per property wins; colors are normalised to hex.
    expect(primary?.base['background-color']).toBe('#533afd');
    expect(primary?.base.color).toBe('#ffffff');
    expect(primary?.base['border-radius']).toBe('6px');
    expect(primary?.base['font-size']).toBe('15px');
    // Hover is kept (differs from base); equivalent spellings normalise to one value.
    expect(primary?.states.hover?.['background-color']).toBe('#4434d4');
    // Transparent backgrounds are normalised; var() values are dropped.
    expect(get('button-secondary')?.base['background-color']).toBe('transparent');
    expect(get('input')?.base.color).toBeUndefined();
    expect(get('input')?.states.focus?.['border-color']).toBe('#533afd');
    // A state that only repeats the base value is dropped.
    expect(
      extractComponents([
        rawComp(
          'card',
          { 'background-color': '#fff' },
          { hover: { 'background-color': 'rgb(255, 255, 255)' } },
        ),
      ])[0]?.states.hover,
    ).toBeUndefined();
    expect(extractComponents(undefined)).toEqual([]);
    expect(extractComponents([])).toEqual([]);

    // Wired through extract(): the scan carries the components and still validates.
    const scan = extract({ ...loadRaw('pages/landing-basic'), components });
    expect(scan.components?.map((c) => c.kind)).toEqual(kinds);
    expect(DesignScanSchema.safeParse(scan).success).toBe(true);
    expect(extract(loadRaw('pages/landing-basic')).components).toBeUndefined();
  });
});

describe('a11y matrix', () => {
  const tok = (id: string, hex: string): ColorToken => {
    const [l, c, h] = toOklch(hex);
    return {
      id,
      hex,
      oklch: [l, c, h],
      alpha: 1,
      weight: 0,
      usage: { bg: 0, text: 0, border: 0, fill: 0 },
    };
  };
  const colors: DesignScan['colors'] = {
    palette: [
      tok('bg', '#ffffff'),
      tok('t1', '#000000'),
      tok('t2', '#777777'), // 4.48:1 -> large text only
      tok('t3', '#aaaaaa'), // 2.32:1 -> fails everything
      tok('acc', '#2563eb'),
      tok('onacc', '#ffffff'),
      tok('bd', '#d4d4d4'),
    ],
    roles: {
      background: 'bg',
      textPrimary: 't1',
      textSecondary: 't2',
      textMuted: 't3',
      accent: 'acc',
      accentForeground: 'onacc',
      border: 'bd',
    },
    gradients: [],
  };

  it('T5.05 correct ratios and AA / AA-large flags, with a passing fix for failing pairs', () => {
    const { pairs } = computeA11y(colors);
    const find = (fg: ColorRole, bg: ColorRole) =>
      pairs.find((p) => p.fgRole === fg && p.bgRole === bg);

    const primary = find('textPrimary', 'background');
    expect(primary?.ratio).toBe(21);
    expect(primary).toMatchObject({ aa: true, aaLarge: true });
    expect(primary?.fix).toBeUndefined();
    expect(primary && pairLevel(primary)).toBe('aa');

    const secondary = find('textSecondary', 'background');
    expect(secondary?.ratio).toBeCloseTo(4.48, 2);
    expect(secondary).toMatchObject({ aa: false, aaLarge: true });
    expect(secondary && pairLevel(secondary)).toBe('aa-large');

    const muted = find('textMuted', 'background');
    expect(muted?.ratio).toBeCloseTo(2.32, 1);
    expect(muted).toMatchObject({ aa: false, aaLarge: false });
    expect(muted && pairLevel(muted)).toBe('fail');

    // Accent foreground on accent, and the border as a 3:1 UI pair.
    expect(find('accentForeground', 'accent')?.kind).toBe('text');
    const border = find('border', 'background');
    expect(border?.kind).toBe('ui');
    expect(border && pairLevel(border)).toBe('fail');

    // Ratios match the contrast function and every offered fix really passes.
    for (const p of pairs) {
      expect(p.ratio, `${p.fgRole}/${p.bgRole}`).toBeCloseTo(contrast(p.fg, p.bg), 1);
      expect(p.aa).toBe(p.ratio >= (p.kind === 'ui' ? 3 : 4.5));
      if (!p.aa && p.fix) {
        expect(contrast(p.fix, p.bg)).toBeGreaterThanOrEqual(p.kind === 'ui' ? 3 : 4.5);
      }
    }
    expect(secondary?.fix).toBeDefined();
    expect(muted?.fix).toBeDefined();

    const scan = { a11y: { pairs } };
    const summary = a11ySummary(scan);
    expect(summary.total).toBe(pairs.length);
    expect(summary.failing.length).toBe(pairs.filter((p) => !p.aa).length);
    const ratios = summary.failing.map((p) => p.ratio);
    expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
    const fixes = a11yFixes(scan);
    expect(fixes.map((f) => f.role).sort()).toEqual(['textMuted', 'textSecondary']);
    for (const f of fixes) expect(contrast(f.to, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('T5.05 extract() output carries a consistent matrix on every fixture', () => {
    for (const name of ALL_NAMES) {
      const scan = scanOf(name);
      expect(scan.a11y?.pairs.length, name).toBeGreaterThan(0);
      for (const p of scan.a11y?.pairs ?? []) {
        expect(p.aa, `${name} ${p.fgRole}`).toBe(p.ratio >= (p.kind === 'ui' ? 3 : 4.5));
        expect(p.aaLarge, name).toBe(p.ratio >= 3);
        if (p.fix) expect(contrast(p.fix, p.bg)).toBeGreaterThanOrEqual(p.kind === 'ui' ? 3 : 4.5);
      }
    }
  });
});

describe('fidelity diff', () => {
  it('T5.06 a scan vs itself scores 100 on every fixture, with no deltas', () => {
    for (const name of ALL_NAMES) {
      const scan = scanOf(name);
      const report = diffScans(scan, structuredClone(scan));
      expect(report.score, name).toBe(100);
      for (const f of Object.values(report.facets)) expect(f.score, name).toBe(100);
      expect(report.deltas, name).toEqual([]);
    }
  });

  it('T5.06 a changed accent lowers the colors facet and is listed as a delta', () => {
    const source = scanOf('landing-basic');
    const accent = roleHex(source, 'accent') as string;
    const report = diffScans(source, withRole(source, 'accent', '#16a34a'));
    expect(report.facets.colors.score).toBeLessThan(100);
    expect(report.score).toBeLessThan(100);
    const delta = report.deltas.find((d) => d.item === 'Accent');
    expect(delta).toMatchObject({ facet: 'colors', expected: accent, actual: '#16a34a' });
    // Only the colors facet moved.
    for (const f of ['typography', 'spacing', 'shape', 'layout'] as const) {
      expect(report.facets[f].score, f).toBe(100);
    }
    // A change that is no smaller in colour distance never scores higher.
    const worse = diffScans(source, withRole(source, 'accent', '#facc15'));
    expect(worse.facets.colors.score).toBeLessThanOrEqual(report.facets.colors.score);
  });

  it('T5.06 every changed facet shows up as a delta, most severe first', () => {
    const source = scanOf('landing-basic');
    const build = withRole(source, 'background', '#101010');
    const body = build.typography.styles.find((s) => s.role === 'body');
    if (body) body.size = body.size + 6;
    build.radii.card = (build.radii.card ?? 0) + 12;
    build.spacing.sectionPaddingY = source.spacing.sectionPaddingY * 2;
    build.layout.containerMaxWidth = 800;
    build.layout.blueprint = build.layout.blueprint.slice(0, 3);
    const report = diffScans(source, build);

    const items = report.deltas.map((d) => `${d.facet}:${d.item}`);
    expect(items).toEqual(
      expect.arrayContaining([
        'colors:Page background',
        'typography:Body text',
        'shape:Card radius',
        'spacing:Section vertical padding',
        'layout:Container width',
        'layout:Section order',
      ]),
    );
    for (const f of ['colors', 'typography', 'spacing', 'shape', 'layout'] as const) {
      expect(report.facets[f].score, f).toBeLessThan(100);
    }
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const sev = report.deltas.map((d) => rank[d.severity]);
    expect(sev).toEqual([...sev].sort((a, b) => a - b));
    for (const d of report.deltas) {
      expect(d.expected, d.item).not.toBe(d.actual);
      expect(d.hint.length, d.item).toBeGreaterThan(0);
    }
    expect(report.score).toBeLessThan(90);
  });

  it('T5.07 fix prompt lists concrete expected-vs-actual values, CSS shadows and clean sections', () => {
    const source = scanOf('stripe');
    const build = withRole(scanOf('landing-serif'), 'accent', '#16a34a');
    const report = diffScans(source, build);
    const prompt = generateFixPrompt(report, source).content;

    expect(prompt).toContain(`${report.score}/100`);
    // Concrete values: the top color deltas name the source hex.
    const colorDeltas = report.deltas.filter((d) => d.facet === 'colors').slice(0, 3);
    expect(colorDeltas.length).toBeGreaterThan(0);
    for (const d of colorDeltas) expect(prompt, d.item).toContain(d.expected);
    expect(prompt).toMatch(/change #[0-9a-f]{6} to #[0-9a-f]{6}/i);
    // Numbered, imperative, ends with the guard line.
    expect(prompt).toMatch(/^1\. /m);
    expect(prompt).toContain("Don't change anything else.");

    // Shadow and section lines (forced into the list so the top-12 cut can't hide them).
    const shadow = report.deltas.find((d) => d.item === 'Shadows');
    const sections = report.deltas.find((d) => d.item === 'Section order');
    expect(shadow?.fix).toBeDefined();
    expect(sections?.fix).toBeDefined();
    const picked = [...colorDeltas, shadow, sections].filter(
      (d): d is NonNullable<typeof d> => !!d,
    );
    const focused = generateFixPrompt({ ...report, deltas: picked }, source).content;
    const shadowLine = focused.split('\n').find((l) => l.includes('Shadows:'));
    expect(shadowLine).toMatch(/`[^`]*\d+px[^`]*`/); // concrete CSS in backticks
    const sectionLine = focused.split('\n').find((l) => l.includes('Sections:'));
    expect(sectionLine).toBeDefined();
    expect(sectionLine).not.toMatch(/content\s*(>|→)\s*content/);

    // Sanitised: the source's host / brand never survives, even when it sits inside a delta.
    const host = source.host.replace(/^www\./, '');
    const brand = host.split('.')[0] as string;
    const dirty = generateFixPrompt(
      {
        ...report,
        deltas: [
          {
            facet: 'typography',
            item: 'Heading font',
            expected: `${brand} Sans from ${host}`,
            actual: 'Georgia',
            severity: 'high',
            hint: '',
          },
        ],
      },
      source,
    ).content.toLowerCase();
    expect(dirty).not.toContain(host);
    expect(dirty).not.toContain(brand);
    expect(prompt.toLowerCase()).not.toContain(host);
    expect(generateFixPrompt({ ...report, deltas: [] }, source).content).toContain(
      'No significant differences',
    );
  });
});

describe('multi-page merge', () => {
  it('T5.08 weights summed, roles stable, meta.pages recorded', () => {
    const a = scanOf('landing-basic');
    const b = { ...scanOf('landing-serif'), url: 'https://example.test/other' };

    // A single scan merges to itself.
    expect(mergeScans([a])).toBe(a);

    // Merging a page with itself keeps the roles (stable) and sums per-page bookkeeping.
    const twice = mergeScans([a, { ...structuredClone(a), url: `${a.url}#2` }]);
    for (const role of [
      'background',
      'surface',
      'textPrimary',
      'textSecondary',
      'accent',
      'border',
    ] as const) {
      expect(roleHex(twice, role), role).toBe(roleHex(a, role));
    }
    expect(twice.meta.sampleCount).toBe(a.meta.sampleCount * 2);
    expect(twice.meta.pages).toEqual([a.url, `${a.url}#2`]);
    expect(DesignScanSchema.safeParse(twice).success).toBe(true);

    // Two different pages: both are recorded, palette weights are normalised sums of both.
    const merged = mergeScans([a, b]);
    expect(merged.meta.pages).toEqual([a.url, b.url]);
    expect(merged.meta.sampleCount).toBe(a.meta.sampleCount + b.meta.sampleCount);
    expect(merged.id).toBe(a.id);
    const hexes = merged.colors.palette.map((t) => t.hex);
    expect(hexes).toContain(roleHex(a, 'accent'));
    expect(hexes).toContain(roleHex(b, 'accent'));
    const total = merged.colors.palette.reduce((s, t) => s + t.weight, 0);
    expect(total).toBeGreaterThan(0.95);
    expect(total).toBeLessThan(1.05);
    expect(merged.a11y?.pairs.length).toBeGreaterThan(0);

    // Deterministic: same input order -> identical output.
    expect(mergeScans([a, b])).toEqual(merged);

    // Merging page by page counts each page once: ((a,b),c) lists all three URLs.
    const c = { ...scanOf('pill'), url: 'https://example.test/third' };
    const stepwise = mergeScans([merged, c]);
    expect(stepwise.meta.pages).toEqual([a.url, b.url, c.url]);
    expect(stepwise.meta.sampleCount).toBe(merged.meta.sampleCount + c.meta.sampleCount);
    expect(() => mergeScans([])).toThrow();
  });
});
