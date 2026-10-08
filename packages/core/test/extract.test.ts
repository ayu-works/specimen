import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deltaE2000 } from '../src/color';
import { extract } from '../src/extract';
import { type ColorRole, type DesignScan, DesignScanSchema, RawPageSchema } from '../src/schema';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const PAGES = ['landing-basic', 'landing-serif', 'dense-app', 'pill', 'injection'] as const;
const REAL = ['linear', 'stripe', 'ramp', 'cal'] as const;

// biome-ignore lint/suspicious/noExplicitAny: expected.json files are loosely typed ground truth
type Expected = any;
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const loadRaw = (p: string) => RawPageSchema.parse(readJson(p));

const raws = Object.fromEntries(
  PAGES.map((n) => [n, loadRaw(join(ROOT, `raw/pages/${n}.json`))]),
) as Record<(typeof PAGES)[number], ReturnType<typeof loadRaw>>;
const expected = Object.fromEntries(
  PAGES.map((n) => [n, readJson(join(ROOT, `pages/${n}.expected.json`)) as Expected]),
) as Record<(typeof PAGES)[number], Expected>;
const scans = Object.fromEntries(PAGES.map((n) => [n, extract(raws[n])])) as Record<
  (typeof PAGES)[number],
  DesignScan
>;

const roleHex = (scan: DesignScan, role: ColorRole): string | undefined => {
  const id = scan.colors.roles[role];
  return id ? scan.colors.palette.find((t) => t.id === id)?.hex : undefined;
};
const styleOf = (scan: DesignScan, role: string) =>
  scan.typography.styles.find((s) => s.role === role);
const family = (scan: DesignScan, which: 'display' | 'body') => {
  const f = scan.typography.families;
  return f.find((x) => x.role === which) ?? f.find((x) => x.role === 'body') ?? f[0];
};
const SECTION_PX = 8;

describe('extract() against ground-truth fixture pages', () => {
  it('T1.13 colour roles within ΔE2000 < 3 of expected', () => {
    const roles = [
      'background',
      'surface',
      'textPrimary',
      'textSecondary',
      'accent',
      'accentForeground',
      'border',
    ] as const;
    for (const n of PAGES) {
      for (const role of roles) {
        const want = expected[n].colors?.[role];
        if (!want) continue;
        const got = roleHex(scans[n], role);
        expect(got, `${n}.${role} missing`).toBeDefined();
        const de = deltaE2000(got as string, want);
        expect(de, `${n}.${role}: got ${got}, want ${want} (ΔE ${de.toFixed(2)})`).toBeLessThan(3);
      }
    }
  });

  it('T1.14 CSS var hint overrides the heuristic accent and sets sourceVar', () => {
    let checked = 0;
    for (const n of PAGES) {
      const vars = expected[n].cssVars as Record<string, string> | undefined;
      if (!vars) continue;
      const accent = scans[n].colors.palette.find((t) => t.id === scans[n].colors.roles.accent);
      expect(accent, n).toBeDefined();
      expect(Object.keys(vars), n).toContain(accent?.sourceVar);
      expect(deltaE2000(accent?.hex as string, expected[n].colors.accent)).toBeLessThan(3);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    // Without a hint (injection declares no accent var) there is no sourceVar from this fixture's set.
    const noHint = scans.injection.colors.palette.find(
      (t) => t.id === scans.injection.colors.roles.accent,
    );
    expect(noHint?.sourceVar === undefined || !/^--brand$/.test(noHint.sourceVar)).toBe(true);
  });

  it('T1.15 semantic colours detected when present, absent otherwise', () => {
    for (const n of PAGES) {
      for (const role of ['success', 'warning', 'danger'] as const) {
        const want = expected[n].colors?.[role];
        const got = roleHex(scans[n], role);
        if (want) {
          expect(got, `${n}.${role} missing`).toBeDefined();
          expect(deltaE2000(got as string, want), `${n}.${role}`).toBeLessThan(3);
        } else {
          expect(got, `${n}.${role} should be absent`).toBeUndefined();
        }
      }
    }
  });

  it('T1.16 typography: body and h1–h3 sizes; display family differs from body on landing-serif', () => {
    for (const n of PAGES) {
      const t = expected[n].typography;
      const tol = n === 'landing-serif' ? 0.1 : 0.5;
      const body = styleOf(scans[n], 'body');
      expect(body, `${n} body`).toBeDefined();
      expect(Math.abs((body?.size ?? 0) - t.body.size), `${n} body size`).toBeLessThanOrEqual(tol);
      expect(body?.weight, `${n} body weight`).toBe(t.body.weight);
      expect(Math.abs((body?.lineHeight ?? 0) - t.body.lineHeight), `${n} body lh`).toBeLessThan(
        0.05,
      );
      for (const h of ['h1', 'h2', 'h3'] as const) {
        const s = styleOf(scans[n], h);
        expect(s, `${n} ${h}`).toBeDefined();
        expect(Math.abs((s?.size ?? 0) - t[h].size), `${n} ${h} size`).toBeLessThanOrEqual(tol);
        expect(s?.weight, `${n} ${h} weight`).toBe(t[h].weight);
      }
    }
    const serif = scans['landing-serif'];
    expect(family(serif, 'display')?.name).not.toBe(family(serif, 'body')?.name);
    expect(family(serif, 'display')?.name).toContain('Playfair');
  });

  it('T1.17 font source detection: google / self-hosted / system', () => {
    for (const n of PAGES) {
      const t = expected[n].typography;
      expect(family(scans[n], 'display')?.source, `${n} display`).toBe(t.displayFamily.source);
      expect(family(scans[n], 'body')?.source, `${n} body`).toBe(t.bodyFamily.source);
    }
    // At least the google and system sources are exercised by the fixtures.
    const sources = new Set(PAGES.map((n) => expected[n].typography.displayFamily.source));
    expect(sources.has('google') && sources.has('system')).toBe(true);
  });

  it('T1.18 scale ratio ≈ 1.25 on the modular-scale fixture, null on irregular ones', () => {
    const ratio = scans['landing-serif'].typography.scaleRatio;
    expect(ratio).not.toBeNull();
    expect(Math.abs((ratio as number) - 1.25)).toBeLessThan(0.03);
    for (const n of PAGES) {
      if (expected[n].typography.scaleRatio === null) {
        expect(scans[n].typography.scaleRatio, n).toBeNull();
      }
    }
  });

  it('T1.19 spacing base unit = 8 (landing-basic), 4 (dense-app)', () => {
    expect(scans['landing-basic'].spacing.baseUnit).toBe(8);
    expect(scans['dense-app'].spacing.baseUnit).toBe(4);
    for (const n of PAGES) expect(scans[n].spacing.baseUnit, n).toBe(expected[n].spacing.baseUnit);
  });

  it('T1.20 section padding Y within ±8px of expected', () => {
    for (const n of PAGES) {
      const got = scans[n].spacing.sectionPaddingY;
      const want = expected[n].spacing.sectionPaddingY;
      expect(Math.abs(got - want), `${n}: got ${got}, want ${want}`).toBeLessThanOrEqual(
        SECTION_PX,
      );
    }
  });

  it('T1.21 radii: button/card/input medians exact; pillButtons true only on pill', () => {
    for (const n of PAGES) {
      const r = expected[n].radii;
      for (const k of ['button', 'card', 'input'] as const) {
        if (r[k] === undefined) continue;
        expect(scans[n].radii[k], `${n}.${k}`).toBe(r[k]);
      }
      expect(scans[n].radii.pillButtons, `${n} pillButtons`).toBe(r.pillButtons);
    }
    expect(scans.pill.radii.pillButtons).toBe(true);
    expect(scans.injection.radii.input).toBe(6);
  });

  it('T1.22 shadows deduped and levelled 1–3', () => {
    for (const n of PAGES) {
      const sh = scans[n].shadows;
      expect(new Set(sh.map((s) => s.css)).size, `${n} dedupe`).toBe(sh.length);
      for (const s of sh) expect([1, 2, 3]).toContain(s.level);
    }
    const pillLevels = new Set(scans.pill.shadows.map((s) => s.level));
    expect(pillLevels.size).toBe(expected.pill.shadows.levels);
    expect([...pillLevels].sort()).toEqual([1, 2, 3]);
  });

  it('T1.23 container max width 1200 (±8), breakpoints sorted and deduped', () => {
    expect(
      Math.abs((scans['landing-basic'].layout.containerMaxWidth ?? 0) - 1200),
    ).toBeLessThanOrEqual(8);
    for (const n of PAGES) {
      const want = expected[n].layout.containerMaxWidth;
      const got = scans[n].layout.containerMaxWidth;
      if (want === null) expect(got, n).toBeNull();
      else expect(Math.abs((got ?? 0) - want), `${n} container`).toBeLessThanOrEqual(8);
      const bps = scans[n].layout.breakpoints;
      expect(bps, `${n} sorted`).toEqual([...bps].sort((a, b) => a - b));
      expect(new Set(bps).size, `${n} deduped`).toBe(bps.length);
      expect(bps, `${n} breakpoints`).toEqual(expected[n].layout.breakpoints);
    }
  });

  it('T1.24 section classifier: ≥ 7/8 on landing-basic, exact on the other fixtures', () => {
    const kinds = (n: (typeof PAGES)[number]) => scans[n].layout.blueprint.map((s) => s.kind);
    const want = expected['landing-basic'].layout.sectionKinds as string[];
    const got = kinds('landing-basic');
    expect(got).toHaveLength(want.length);
    const correct = want.filter((k, i) => got[i] === k).length;
    expect(correct, `landing-basic kinds ${got.join(',')}`).toBeGreaterThanOrEqual(7);
    for (const n of PAGES) {
      if (n === 'landing-basic') continue;
      expect(kinds(n), n).toEqual(expected[n].layout.sectionKinds);
    }
  });

  it('T1.25 density classification compact / comfortable / airy', () => {
    for (const n of PAGES) expect(scans[n].layout.density, n).toBe(expected[n].layout.density);
    const seen = new Set(PAGES.map((n) => scans[n].layout.density));
    expect(seen).toEqual(new Set(['compact', 'comfortable', 'airy']));
  });

  it('T1.26 extract() output validates against DesignScan for every fixture', () => {
    const files = [
      ...PAGES.map((n) => [n, raws[n]] as const),
      ...REAL.map((n) => [n, loadRaw(join(ROOT, `raw/${n}.json`))] as const),
    ];
    for (const [name, raw] of files) {
      const scan = extract(raw, { validate: false });
      const parsed = DesignScanSchema.safeParse(scan);
      expect(
        parsed.success,
        `${name}: ${parsed.success ? '' : parsed.error.message.slice(0, 300)}`,
      ).toBe(true);
      // Deterministic, JSON-safe, and survives a round trip.
      expect(DesignScanSchema.parse(JSON.parse(JSON.stringify(scan)))).toEqual(scan);
    }
  });
});

// Deterministic projection of a scan (no ids, timing or timestamps).
function project(scan: DesignScan) {
  const hexOf = (id?: string) => scan.colors.palette.find((t) => t.id === id)?.hex ?? null;
  return {
    roles: Object.fromEntries(
      Object.entries(scan.colors.roles)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([role, id]) => [role, hexOf(id)]),
    ),
    typeStyles: scan.typography.styles.map((s) => ({
      role: s.role,
      size: s.size,
      weight: s.weight,
      lineHeight: Math.round(s.lineHeight * 100) / 100,
    })),
    baseSize: scan.typography.baseSize,
    spacing: {
      baseUnit: scan.spacing.baseUnit,
      scale: scan.spacing.scale,
      sectionPaddingY: scan.spacing.sectionPaddingY,
    },
    radii: {
      scale: scan.radii.scale.map((r) => r.value),
      button: scan.radii.button,
      card: scan.radii.card,
      input: scan.radii.input,
      pillButtons: scan.radii.pillButtons,
    },
    layout: {
      containerMaxWidth: scan.layout.containerMaxWidth,
      gutter: scan.layout.gutter,
      breakpoints: scan.layout.breakpoints,
      density: scan.layout.density,
    },
    sectionKinds: scan.layout.blueprint.map((s) => s.kind),
  };
}

describe('extract() on real-site raw fixtures', () => {
  for (const name of REAL) {
    it(`T1.27 snapshot is stable: ${name}`, () => {
      const scan = extract(loadRaw(join(ROOT, `raw/${name}.json`)));
      expect(project(scan)).toMatchSnapshot();
    });
  }

  it('T1.28 extract() median of 5 runs < 200 ms on the largest raw fixture', () => {
    const files = REAL.map((n) => join(ROOT, `raw/${n}.json`));
    const largest = files
      .map((f) => ({ f, raw: loadRaw(f) }))
      .sort((a, b) => b.raw.samples.length - a.raw.samples.length)[0];
    expect(largest).toBeDefined();
    const raw = largest?.raw as ReturnType<typeof loadRaw>;
    extract(raw); // warm-up (JIT)
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      extract(raw);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[2] as number;
    expect(median, `median ${median.toFixed(1)}ms over ${raw.samples.length} samples`).toBeLessThan(
      200,
    );
  });
});
