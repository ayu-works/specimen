import { describe, expect, it } from 'vitest';
import { compose } from '../src/compose';
import { mergeScans } from '../src/extract/merge';
import { generateDesignMd, generatePrompt } from '../src/generate';
import {
  type DesignScan,
  DesignScanSchema,
  migrate,
  RawPageSchema,
  SCHEMA_VERSION,
} from '../src/schema';
import { withCounterpart } from '../src/theme';
import minimalRaw from './fixtures/minimal-raw.json';
import minimalScan from './fixtures/minimal-scan.json';
import { ALL_NAMES, scanOf } from './helpers';

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

    // older stored scans (v1, v2) upgrade to the current version
    for (const v of [1, 2, 3]) {
      expect(migrate({ ...minimalScan, schemaVersion: v }).schemaVersion).toBe(SCHEMA_VERSION);
    }
    expect(() => migrate({ ...minimalScan, schemaVersion: SCHEMA_VERSION + 1 })).toThrow();
    expect(() => migrate({})).toThrow();
  });
});

const REPAIR_WARNING = /^Repaired on upgrade/;
type Scan = DesignScan;
const v4 = (): Scan => structuredClone(minimalScan) as unknown as Scan;
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
    expect(SCHEMA_VERSION).toBe(4);
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
      const s = v4();
      mutate(s);
      expect(DesignScanSchema.safeParse(s).success, name).toBe(false);
      expect(() => migrate(s), name).toThrow();
    }
    // A variant with no palette may point at base palette ids (the lookup `roleColors` uses).
    const ok = v4();
    ok.variants = { dark: { roles: { background: 'c2' } } };
    expect(DesignScanSchema.safeParse(ok).success).toBe(true);
  });

  it('T1.01 v1–v3 rows are repaired on upgrade: fixable hex normalised, unfixable color and its roles dropped', () => {
    const old = { ...v4(), schemaVersion: 3 } as unknown as Scan;
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
    expect(out.schemaVersion).toBe(4);
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
    const old = { ...v4(), schemaVersion: 3 } as unknown as Scan;
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
    const old = { ...v4(), schemaVersion: 3, junk: deep } as unknown as Scan;
    old.colors.palette.push(tok('c3', '#ABC'));
    const out = migrate(old);
    expect(out).not.toHaveProperty('junk');
    expect(out.colors.palette.find((t) => t.id === 'c3')?.hex).toBe('#aabbcc');
    // The parts it repaired are copies: the input keeps its own palette, variants and warnings.
    expect(old.colors.palette.find((t) => t.id === 'c3')?.hex).toBe('#ABC');
    expect(old.meta.warnings.some((w) => REPAIR_WARNING.test(w))).toBe(false);
  });

  it('T1.01 clean v1–v3 rows upgrade unchanged, with no repair warning', () => {
    for (const v of [1, 2, 3]) {
      const out = migrate({ ...v4(), schemaVersion: v });
      expect(out).toEqual(DesignScanSchema.parse(v4()));
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
      // Read back as an old row: the repair finds nothing to change.
      expect(migrate({ ...s, schemaVersion: 3 }), name).toEqual(DesignScanSchema.parse(s));
    }
  });
});
