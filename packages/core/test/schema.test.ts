import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { compose } from '../src/compose';
import { extract } from '../src/extract';
import { mergeScans } from '../src/extract/merge';
import { generateDesignMd, generatePrompt } from '../src/generate';
import {
  BOUNDS,
  type DesignScan,
  DesignScanSchema,
  migrate,
  RawPageSchema,
  SCHEMA_VERSION,
} from '../src/schema';
import { MAX } from '../src/schema/bounds';
import { withCounterpart } from '../src/theme';
import minimalRaw from './fixtures/minimal-raw.json';
import minimalScan from './fixtures/minimal-scan.json';
import { ALL_NAMES, loadRaw, scanOf } from './helpers';

describe('schemas', () => {
  it('T1.01 RawPage and DesignScan schemas round-trip fixtures and reject missing fields', () => {
    expect(SCHEMA_VERSION).toBe(minimalScan.schemaVersion);

    const raw = RawPageSchema.parse(minimalRaw);
    expect(RawPageSchema.parse(JSON.parse(JSON.stringify(raw)))).toEqual(raw);

    const scan = DesignScanSchema.parse(minimalScan);
    expect(DesignScanSchema.parse(JSON.parse(JSON.stringify(scan)))).toEqual(scan);
    expect(migrate(minimalScan)).toEqual(scan);

    // missing required fields are rejected
    const { url: _url, ...rawNoUrl } = minimalRaw;
    expect(RawPageSchema.safeParse(rawNoUrl).success).toBe(false);
    const { samples: _samples, ...rawNoSamples } = minimalRaw;
    expect(RawPageSchema.safeParse(rawNoSamples).success).toBe(false);

    const { colors: _colors, ...scanNoColors } = minimalScan;
    expect(DesignScanSchema.safeParse(scanNoColors).success).toBe(false);
    expect(
      DesignScanSchema.safeParse({ ...minimalScan, schemaVersion: SCHEMA_VERSION - 1 }).success,
    ).toBe(false);

    // older stored scans (v1–v4) upgrade to the current version
    for (const v of [1, 2, 3, 4]) {
      expect(migrate({ ...minimalScan, schemaVersion: v }).schemaVersion).toBe(SCHEMA_VERSION);
    }
    expect(() => migrate({ ...minimalScan, schemaVersion: SCHEMA_VERSION + 1 })).toThrow();
    expect(() => migrate({})).toThrow();
  });
});

const REPAIR_WARNING = /^Repaired on upgrade/;
type Scan = DesignScan;
/** A clean scan at the current version. */
const cur = (): Scan => structuredClone(minimalScan) as unknown as Scan;
const tok = (id: string, hex: string) => ({
  id,
  hex,
  oklch: [0.5, 0.1, 200] as [number, number, number],
  alpha: 1,
  weight: 0.1,
  usage: { bg: 0, text: 0, border: 0, fill: 0.1 },
});

describe('schema integrity (audit H4)', () => {
  it('T1.01 v4 is strict: a non-#rrggbb hex or a role pointing outside its palette is rejected', () => {
    expect(SCHEMA_VERSION).toBe(5);
    const withToken = (hex: string) => (s: Scan) => {
      s.colors.palette.push(tok('c9', hex));
    };
    const withDark = (dark: NonNullable<Scan['variants']>['dark']) => (s: Scan) => {
      s.variants = { dark };
    };
    const bad: [string, (s: Scan) => void][] = [
      ['hex zzz', withToken('zzz')],
      ['hex #ABC', withToken('#ABC')],
      ['hex uppercase', withToken('#AABBCC')],
      ['hex 8-digit', withToken('#aabbcc80')],
      [
        'dangling role',
        (s) => {
          s.colors.roles.link = 'nope';
        },
      ],
      ['variant hex', withDark({ palette: [tok('d1', 'blue')], roles: { background: 'd1' } })],
      [
        'variant role outside its palette',
        withDark({ palette: [tok('d1', '#000000')], roles: { background: 'c1' } }),
      ],
      [
        'variant role with no palette, outside the base palette',
        withDark({ roles: { background: 'missing' } }),
      ],
    ];
    for (const [name, mutate] of bad) {
      const s = cur();
      mutate(s);
      expect(DesignScanSchema.safeParse(s).success, name).toBe(false);
      expect(() => migrate(s), name).toThrow();
      // A stored v4 row breaking the v4 rules is rejected too: the v5 upgrade only trims.
      expect(() => migrate({ ...s, schemaVersion: 4 }), name).toThrow();
    }
    // A variant with no palette may point at base palette ids (the lookup `roleColors` uses).
    const ok = cur();
    ok.variants = { dark: { roles: { background: 'c2' } } };
    expect(DesignScanSchema.safeParse(ok).success).toBe(true);
  });

  it('T1.01 v1–v3 rows are repaired on upgrade: fixable hex normalised, unfixable color and its roles dropped', () => {
    const old = { ...cur(), schemaVersion: 3 } as unknown as Scan;
    old.colors.palette.push(tok('c3', '#ABC'), tok('c4', 'zzz'), tok('c5', 'rgb(255, 0, 0)'));
    old.colors.roles = {
      ...old.colors.roles,
      link: 'c3',
      danger: 'c4',
      success: 'gone',
      warning: 'c5',
    };
    old.variants = {
      dark: {
        palette: [tok('d1', '#000000'), tok('d2', 'not a color')],
        roles: { background: 'd1', accent: 'd2' },
      },
    };
    const input = structuredClone(old);

    const out = migrate(old);
    expect(old, 'input not mutated').toEqual(input);
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    const hexOf = (id: string) => out.colors.palette.find((t) => t.id === id)?.hex;
    expect(hexOf('c3')).toBe('#aabbcc');
    expect(hexOf('c5')).toBe('#ff0000');
    expect(hexOf('c4')).toBeUndefined();
    // oklch is recomputed for a normalised token (red is ~0.628 L, hue ~29)
    const red = out.colors.palette.find((t) => t.id === 'c5');
    expect(red?.oklch[0]).toBeCloseTo(0.628, 2);
    expect(out.colors.roles).toEqual({ background: 'c1', accent: 'c2', link: 'c3', warning: 'c5' });
    expect(out.variants?.dark?.palette?.map((t) => t.id)).toEqual(['d1']);
    expect(out.variants?.dark?.roles).toEqual({ background: 'd1' });
    const warnings = out.meta.warnings.filter((w) => REPAIR_WARNING.test(w));
    expect(warnings).toHaveLength(1);

    // Generate works on the repaired scan.
    expect(() => generatePrompt(out)).not.toThrow();
    expect(() => generateDesignMd(out)).not.toThrow();

    // Idempotent: the repaired row, re-read or re-saved as v4, changes nothing and gains no second warning.
    expect(migrate(out)).toEqual(out);
    expect(migrate({ ...out, schemaVersion: 3 })).toEqual(out);
  });

  it('T1.01 repair keeps translucency and drops fully transparent tokens (lens B B5)', () => {
    const old = { ...cur(), schemaVersion: 3 } as unknown as Scan;
    old.colors.palette.push(tok('c3', 'transparent'), tok('c4', 'rgba(1, 2, 3, 0.5)'));
    old.colors.roles = { ...old.colors.roles, surface: 'c3', border: 'c4' };
    const out = migrate(old);
    expect(out.colors.palette.find((t) => t.id === 'c3')).toBeUndefined();
    expect(out.colors.roles.surface).toBeUndefined();
    const half = out.colors.palette.find((t) => t.id === 'c4');
    expect(half?.hex).toBe('#010203');
    expect(half?.alpha).toBe(0.5);
  });

  it('T1.01 repair copies only what it changes: a deeply nested junk key is dropped, not cloned (sec L1)', () => {
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 100_000; i++) deep = { d: deep };
    const old = { ...cur(), schemaVersion: 3, junk: deep } as unknown as Scan;
    old.colors.palette.push(tok('c3', '#ABC'));
    const out = migrate(old);
    expect(out).not.toHaveProperty('junk');
    expect(out.colors.palette.find((t) => t.id === 'c3')?.hex).toBe('#aabbcc');
    // The parts it repaired are copies: the input keeps its own palette, variants and warnings.
    expect(old.colors.palette.find((t) => t.id === 'c3')?.hex).toBe('#ABC');
    expect(old.meta.warnings.some((w) => REPAIR_WARNING.test(w))).toBe(false);
  });

  it('T1.01 clean v1–v4 rows upgrade unchanged, with no repair or trim warning', () => {
    for (const v of [1, 2, 3, 4]) {
      const out = migrate({ ...cur(), schemaVersion: v });
      expect(out).toEqual(DesignScanSchema.parse(cur()));
    }
  });

  it('T1.01 v4 drops no real extractor output: every fixture, a merge, a compose and a derived variant', () => {
    const scans: [string, Scan][] = ALL_NAMES.map((n) => [n, scanOf(n)]);
    scans.push([
      'merge',
      mergeScans([scanOf('linear'), { ...scanOf('stripe'), url: 'https://x.test/2' }]),
    ]);
    scans.push([
      'compose',
      compose({ colors: scanOf('cal'), typography: scanOf('ramp') }, scanOf('pill')),
    ]);
    for (const n of ALL_NAMES) scans.push([`${n}+counterpart`, withCounterpart(scanOf(n))]);
    for (const [name, s] of scans) {
      expect(s.schemaVersion, name).toBe(SCHEMA_VERSION);
      const parsed = DesignScanSchema.safeParse(s);
      expect(parsed.success, `${name}: ${parsed.error?.message}`).toBe(true);
      // Read back as an old row: neither the repair nor the v5 trim finds anything to change.
      expect(migrate({ ...s, schemaVersion: 3 }), name).toEqual(DesignScanSchema.parse(s));
      expect(migrate({ ...s, schemaVersion: 4 }), name).toEqual(DesignScanSchema.parse(s));
    }
  });
});

const TRIM_WARNING = /^Trimmed on upgrade/;
type Def = {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  keyType?: z.ZodType;
  valueType?: z.ZodType;
  options?: z.ZodType[];
};
const defOf = (s: z.ZodType) => (s as unknown as { _zod: { def: Def } })._zod.def;

/** Paths of string, array and record nodes in a schema that carry no bound. */
function unbounded(schema: z.ZodType, path = ''): string[] {
  const d = defOf(schema);
  // A record keyed by an enum (roles, component states) is bounded by its keys.
  const enumKeys = d.keyType !== undefined && defOf(d.keyType).type === 'enum';
  const here =
    ['string', 'array', 'record'].includes(d.type) && !MAX.has(schema) && !enumKeys ? [path] : [];
  const kids: [z.ZodType | undefined, string][] = [
    [d.innerType, path],
    [d.element, `${path}[]`],
    [d.keyType, `${path}{key}`],
    [d.valueType, `${path}.*`],
    ...Object.entries(d.shape ?? {}).map(([k, v]): [z.ZodType, string] => [v, `${path}.${k}`]),
  ];
  return [...here, ...kids.flatMap(([k, p]) => (k ? unbounded(k, p) : []))];
}

describe('v5 size bounds (sec M2)', () => {
  it('T1.01 every string, array and record in the scan schema has a bound (hex is bounded by its pattern)', () => {
    const open = unbounded(DesignScanSchema).filter((p) => !p.endsWith('.hex'));
    expect(open).toEqual([]);
  });

  const over: [string, (s: Scan) => void][] = [
    [
      'title',
      (s) => {
        s.title = 'x'.repeat(BOUNDS.title + 1);
      },
    ],
    [
      'url',
      (s) => {
        s.url = `https://a.test/${'x'.repeat(BOUNDS.url)}`;
      },
    ],
    [
      'host',
      (s) => {
        s.host = 'h'.repeat(BOUNDS.host + 1);
      },
    ],
    [
      'palette',
      (s) => {
        s.colors.palette = Array.from({ length: BOUNDS.palette + 1 }, (_, i) =>
          tok(`p${i}`, '#000000'),
        );
        s.colors.roles = { background: 'p0' };
      },
    ],
    [
      'cssVariables count',
      (s) => {
        s.cssVariables = Object.fromEntries(
          Array.from({ length: BOUNDS.cssVariables + 1 }, (_, i) => [`--v${i}`, '1']),
        );
      },
    ],
    [
      'cssVariables key',
      (s) => {
        s.cssVariables = { [`--${'k'.repeat(BOUNDS.cssVarKey)}`]: '1' };
      },
    ],
    [
      'cssVariables value',
      (s) => {
        s.cssVariables = { '--v': 'v'.repeat(BOUNDS.cssVarValue + 1) };
      },
    ],
    [
      'warnings count',
      (s) => {
        s.meta.warnings = Array.from({ length: BOUNDS.warnings + 1 }, (_, i) => `w${i}`);
      },
    ],
    [
      'warning length',
      (s) => {
        s.meta.warnings = ['w'.repeat(BOUNDS.warning + 1)];
      },
    ],
    [
      'pages',
      (s) => {
        s.meta.pages = Array.from({ length: BOUNDS.pages + 1 }, (_, i) => `https://a.test/${i}`);
      },
    ],
    [
      'vibe summary',
      (s) => {
        s.vibe = { summary: 's'.repeat(BOUNDS.vibeSummary + 1), keywords: [], model: 'm' };
      },
    ],
    [
      'vibe keywords',
      (s) => {
        s.vibe = {
          summary: '',
          keywords: Array.from({ length: BOUNDS.keywords + 1 }, () => 'k'),
          model: 'm',
        };
      },
    ],
    [
      'gradient css',
      (s) => {
        s.colors.gradients = [{ css: 'c'.repeat(BOUNDS.text + 1), weight: 1 }];
      },
    ],
    [
      'shadows',
      (s) => {
        s.shadows = Array.from({ length: BOUNDS.list + 1 }, () => ({
          css: 'none',
          weight: 1,
          level: 1 as const,
        }));
      },
    ],
  ];

  it('T1.01 a v5 scan over any bound is rejected; the same row stored as v4 is trimmed once, idempotently', () => {
    for (const [name, mutate] of over) {
      const s = cur();
      mutate(s);
      expect(DesignScanSchema.safeParse(s).success, name).toBe(false);
      expect(() => migrate(s), name).toThrow();

      const old = { ...structuredClone(s), schemaVersion: 4 };
      const input = structuredClone(old);
      const out = migrate(old);
      expect(old, `${name}: input not mutated`).toEqual(input);
      expect(
        out.meta.warnings.filter((w) => TRIM_WARNING.test(w)),
        name,
      ).toHaveLength(1);
      expect(DesignScanSchema.safeParse(out).success, name).toBe(true);
      expect(migrate(out), name).toEqual(out);
      expect(migrate({ ...out, schemaVersion: 4 }), name).toEqual(out);
    }
  });

  it('T1.01 a hostile v4 row (150k palette, 100k variables, 30k title) upgrades trimmed, with valid roles', () => {
    const s = cur();
    s.colors.palette = Array.from({ length: 150_000 }, (_, i) => tok(`p${i}`, '#123456'));
    s.colors.roles = { background: 'p0', accent: 'p149999' };
    s.variants = { dark: { roles: { background: 'p149998', textPrimary: 'p1' } } };
    s.cssVariables = Object.fromEntries(
      Array.from({ length: 100_000 }, (_, i) => [`--color-${i}`, 'red']),
    );
    s.title = 'word '.repeat(6000);
    s.meta.warnings = Array.from({ length: 500 }, (_, i) => `w${i}`);
    const t0 = performance.now();
    const out = migrate({ ...s, schemaVersion: 4 });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(out.colors.palette).toHaveLength(BOUNDS.palette);
    expect(out.colors.palette[0]?.id).toBe('p0');
    // Roles that pointed at cut colors are dropped; the rest stay.
    expect(out.colors.roles).toEqual({ background: 'p0' });
    expect(out.variants?.dark?.roles).toEqual({ textPrimary: 'p1' });
    expect(Object.keys(out.cssVariables)).toHaveLength(BOUNDS.cssVariables);
    expect(out.title).toHaveLength(BOUNDS.title);
    expect(out.meta.warnings).toHaveLength(BOUNDS.warnings);
    const notes = out.meta.warnings.filter((w) => TRIM_WARNING.test(w));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/colors\.palette/);
    expect(migrate(out)).toEqual(out);
  });

  it('T1.01 our own producers stay inside the bounds: merge, compose and extract clamp', () => {
    const vars = (n: number) =>
      Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`--color-${n}-${i}`, 'red']));
    const pages = (n: number) => Array.from({ length: 30 }, (_, i) => `https://a.test/${n}/${i}`);
    const four = [0, 1, 2, 3].map((n) => ({
      ...scanOf('linear'),
      url: `https://a.test/${n}`,
      cssVariables: vars(n),
      meta: { ...scanOf('linear').meta, pages: pages(n) },
    }));
    const merged = mergeScans(four);
    expect(DesignScanSchema.safeParse(merged).success).toBe(true);
    expect(Object.keys(merged.cssVariables)).toHaveLength(BOUNDS.cssVariables);
    expect(merged.meta.pages).toHaveLength(BOUNDS.pages);
    expect(merged.meta.warnings.some((w) => TRIM_WARNING.test(w))).toBe(false);

    const long = (host: string) => ({ ...scanOf('cal'), id: host, host: 'h'.repeat(250) + host });
    const composed = compose(
      { colors: long('a'), typography: long('b'), spacing: long('c'), shape: long('d') },
      long('e'),
    );
    expect(composed.title.length).toBeLessThanOrEqual(BOUNDS.title);
    expect(DesignScanSchema.safeParse(composed).success).toBe(true);

    const raw = loadRaw('linear');
    const page = extract({ ...raw, title: 'word '.repeat(6000), warnings: Array(300).fill('w') });
    expect(page.title).toHaveLength(BOUNDS.title);
    expect(page.meta.warnings).toHaveLength(BOUNDS.warnings);
  });
});
