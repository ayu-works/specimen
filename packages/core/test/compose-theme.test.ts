import { describe, expect, it } from 'vitest';
import { contrast, toOklch } from '../src/color';
import { compose } from '../src/compose';
import { DesignScanSchema } from '../src/schema';
import { deriveCounterpart, detectScheme, withCounterpart } from '../src/theme';
import { ALL_NAMES, roleHex, scanOf } from './helpers';

describe('compose', () => {
  it("T4.04 colors from A + type from B → valid DesignScan with A's palette and B's styles", () => {
    const a = scanOf('landing-basic');
    const b = scanOf('landing-serif');
    const out = compose({ colors: a, typography: b }, a, { id: 'composed-test' });

    expect(DesignScanSchema.safeParse(out).success).toBe(true);
    expect(out.id).toBe('composed-test');
    // A's palette (roles resolve to the same hexes), B's type styles.
    for (const role of ['background', 'surface', 'accent', 'border'] as const) {
      expect(roleHex(out, role), role).toBe(roleHex(a, role));
    }
    expect(out.colors.palette.map((t) => t.hex).sort()).toEqual(
      a.colors.palette.map((t) => t.hex).sort(),
    );
    expect(out.typography).toEqual(b.typography);
    expect(out.typography.styles).not.toEqual(a.typography.styles);
    // Facets not specified come from the base.
    expect(out.spacing).toEqual(a.spacing);
    expect(out.radii).toEqual(a.radii);
    expect(out.layout).toEqual(a.layout);
    // Provenance is recorded.
    expect(out.meta.pages).toEqual(expect.arrayContaining([a.url, b.url]));
    expect(out.title).toContain('type from');
    // Inputs are not mutated.
    expect(a).toEqual(scanOf('landing-basic'));
    expect(b).toEqual(scanOf('landing-serif'));
  });

  it('T4.05 contrast fix-up: a failing accentForeground is adjusted to pass AA, with a warning', () => {
    const a = scanOf('landing-basic');
    const accent = roleHex(a, 'accent') as string;
    // Make the text-on-accent colour fail AA.
    const bad = structuredClone(a);
    const fgId = bad.colors.roles.accentForeground as string;
    const tok = bad.colors.palette.find((t) => t.id === fgId);
    expect(tok).toBeDefined();
    const nearly = '#777777'; // mid grey: poor on the indigo accent
    (tok as { hex: string }).hex = nearly;
    (tok as { oklch: [number, number, number] }).oklch = toOklch(nearly);
    expect(contrast(nearly, accent)).toBeLessThan(4.5);

    const out = compose({ colors: bad }, scanOf('pill'));
    const fg = roleHex(out, 'accentForeground') as string;
    expect(roleHex(out, 'accent')).toBe(accent);
    expect(contrast(fg, accent)).toBeGreaterThanOrEqual(4.5);
    expect(fg).not.toBe(nearly);
    expect(out.meta.warnings.some((w) => w.includes('accentForeground'))).toBe(true);

    // Text roles that already pass are left alone.
    const clean = compose({ colors: scanOf('landing-basic') }, scanOf('pill'));
    expect(clean.meta.warnings.filter((w) => w.includes('textPrimary'))).toEqual([]);
  });
});

describe('theme derivation', () => {
  it('T4.06 derived counterpart passes AA for textPrimary and textSecondary on the background', () => {
    let checked = 0;
    for (const name of ALL_NAMES) {
      const scan = scanOf(name);
      const derived = deriveCounterpart(scan.colors);
      // The counterpart flips the scheme.
      expect(detectScheme(derived), `${name} scheme`).not.toBe(detectScheme(scan.colors));
      const hex = (r: Parameters<typeof roleHex>[1]) => {
        const id = derived.roles[r];
        return id ? derived.palette.find((t) => t.id === id)?.hex : undefined;
      };
      const bg = hex('background') as string;
      expect(bg, `${name} background`).toBeDefined();
      const primary = hex('textPrimary');
      expect(primary, `${name} textPrimary`).toBeDefined();
      expect(contrast(primary as string, bg), `${name} textPrimary`).toBeGreaterThanOrEqual(4.5);
      const secondary = hex('textSecondary');
      if (roleHex(scan, 'textSecondary')) {
        expect(secondary, `${name} textSecondary`).toBeDefined();
        expect(contrast(secondary as string, bg), `${name} textSecondary`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      const fgOnAccent = hex('accentForeground');
      const accent = hex('accent');
      if (fgOnAccent && accent) {
        expect(contrast(fgOnAccent, accent), `${name} on accent`).toBeGreaterThanOrEqual(4.5);
      }
      checked++;
    }
    expect(checked).toBe(ALL_NAMES.length);

    // withCounterpart attaches the variant under the opposite key and is idempotent.
    const light = scanOf('landing-basic');
    const withDark = withCounterpart(light);
    expect(withDark.variants?.dark?.roles).toBeDefined();
    expect(withCounterpart(withDark)).toBe(withDark);
    const dark = scanOf('linear');
    expect(withCounterpart(dark).variants?.light?.roles).toBeDefined();
    expect(DesignScanSchema.safeParse(withDark).success).toBe(true);
  });
});
