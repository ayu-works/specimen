import { describe, expect, it } from 'vitest';
import {
  clusterColors,
  composite,
  contrast,
  deltaE2000,
  deltaE2000Lab,
  type Lab,
  parseColor,
  toHex,
  toOklab,
  toOklch,
} from '../src/color';

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

describe('parseColor', () => {
  it('T1.02 parseColor handles hex/rgb/rgba/hsl/oklch/color()/named/transparent', () => {
    expect(parseColor('#f00')).toEqual({ r: 1, g: 0, b: 0, alpha: 1 });
    const h4 = parseColor('#0f08');
    expect(h4?.g).toBe(1);
    expect(near(h4?.alpha ?? 0, 0x88 / 255, 1e-6)).toBe(true);
    expect(toHex(parseColor('#5e6ad2') ?? { r: 0, g: 0, b: 0, alpha: 1 })).toBe('#5e6ad2');
    expect(toHex(parseColor('#5e6ad2ff') as never)).toBe('#5e6ad2');
    expect(near(parseColor('#5e6ad280')?.alpha ?? 0, 128 / 255, 1e-6)).toBe(true);

    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0, alpha: 1 });
    expect(parseColor('rgb(255 0 0)')).toEqual({ r: 1, g: 0, b: 0, alpha: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, alpha: 0.5 });
    expect(parseColor('rgb(0 0 0 / 50%)')).toEqual({ r: 0, g: 0, b: 0, alpha: 0.5 });

    expect(toHex(parseColor('hsl(0, 100%, 50%)') as never)).toBe('#ff0000');
    expect(toHex(parseColor('hsl(120deg 100% 25%)') as never)).toBe('#008000');

    const ok = parseColor('oklch(0.628 0.2577 29.23)');
    expect(ok).not.toBeNull();
    expect(toHex(ok as never)).toBe('#ff0000');

    expect(toHex(parseColor('color(srgb 1 0 0)') as never)).toBe('#ff0000');
    expect(near(parseColor('color(srgb 0.5 0.5 0.5 / 0.25)')?.alpha ?? 0, 0.25, 1e-9)).toBe(true);

    expect(toHex(parseColor('rebeccapurple') as never)).toBe('#663399');
    expect(toHex(parseColor('white') as never)).toBe('#ffffff');
    expect(parseColor('transparent')?.alpha).toBe(0);

    expect(parseColor('not-a-color')).toBeNull();
    expect(parseColor('')).toBeNull();

    const [l, c] = toOklch('#ffffff');
    expect(near(l, 1, 1e-3)).toBe(true);
    expect(c).toBeLessThan(0.01);
  });
});

describe('contrast', () => {
  it('T1.03 WCAG contrast reference values', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrast('#fff', '#000')).toBeCloseTo(21, 5);
    expect(contrast('#777', '#fff')).toBeCloseTo(4.48, 1);
    expect(contrast('#fff', '#fff')).toBeCloseTo(1, 5);
  });
});

// Subset of Sharma, Wu & Dalal (2005) CIEDE2000 test data: [L1,a1,b1, L2,a2,b2, expected ΔE00]
const SHARMA: [number, number, number, number, number, number, number][] = [
  [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
  [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
  [50, 2.8361, -74.02, 50, 0, -82.7485, 3.4412],
  [50, -1.3802, -84.2814, 50, 0, -82.7485, 1.0],
  [50, -1.1848, -84.8006, 50, 0, -82.7485, 1.0],
  [50, -0.9009, -85.5211, 50, 0, -82.7485, 1.0],
  [50, 0, 0, 50, -1, 2, 2.3669],
  [50, -1, 2, 50, 0, 0, 2.3669],
  [50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792],
  [50, 2.5, 0, 50, 0, -2.5, 4.3065],
  [50, 2.5, 0, 73, 25, -18, 27.1492],
  [50, 2.5, 0, 61, -5, 29, 22.8977],
  [50, 2.5, 0, 56, -27, -3, 31.903],
  [50, 2.5, 0, 58, 24, 15, 19.4535],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
];

describe('deltaE2000', () => {
  it('T1.04 deltaE2000 matches Sharma reference pairs within 0.01', () => {
    expect(SHARMA.length).toBeGreaterThanOrEqual(8);
    for (const [l1, a1, b1, l2, a2, b2, expected] of SHARMA) {
      const x: Lab = { l: l1, a: a1, b: b1 };
      const y: Lab = { l: l2, a: a2, b: b2 };
      expect(Math.abs(deltaE2000Lab(x, y) - expected)).toBeLessThan(0.01);
    }
    // CSS-level wrapper sanity
    expect(deltaE2000('#fff', '#fff')).toBe(0);
    expect(deltaE2000('#000', '#fff')).toBeGreaterThan(90);
    expect(toOklab('#fff')[0]).toBeCloseTo(1, 2);
  });
});

describe('composite', () => {
  it('T1.05 alpha composite rgba(0,0,0,.5) over white is #808080 (±1)', () => {
    const out = composite('rgba(0,0,0,.5)', '#ffffff');
    expect(out.alpha).toBe(1);
    const hex = toHex(out);
    const v = Number.parseInt(hex.slice(1, 3), 16);
    expect(Math.abs(v - 0x80)).toBeLessThanOrEqual(1);
    expect(hex.slice(1, 3)).toBe(hex.slice(3, 5));
    expect(hex.slice(3, 5)).toBe(hex.slice(5, 7));
  });
});

describe('clusterColors', () => {
  it('T1.06 clustering merges near-duplicate grays, keeps accents, caps at 24', () => {
    const tokens = clusterColors([
      { color: '#fafafa', weight: 50, usage: 'bg' },
      { color: '#f9f9f9', weight: 20, usage: 'bg' },
      { color: '#fbfbfb', weight: 10, usage: 'bg' },
      { color: '#5e6ad2', weight: 30, usage: 'fill' },
      { color: '#6e79d6', weight: 25, usage: 'text' },
      { color: '#111111', weight: 40, usage: 'text' },
    ]);
    const grays = tokens.filter((t) => ['#f9f9f9', '#fafafa', '#fbfbfb'].includes(t.hex));
    expect(grays).toHaveLength(1);
    expect(grays[0]?.hex).toBe('#fafafa'); // highest-weight member
    expect(tokens.map((t) => t.hex)).toContain('#5e6ad2');
    expect(tokens.map((t) => t.hex)).toContain('#6e79d6');
    expect(tokens).toHaveLength(4);
    expect(tokens.map((t) => t.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(tokens.reduce((s, t) => s + t.weight, 0)).toBeCloseTo(1, 9);
    expect(grays[0]?.usage.bg).toBeCloseTo(80 / 175, 9);

    // weights sorted descending
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i - 1]?.weight ?? 0).toBeGreaterThanOrEqual(tokens[i]?.weight ?? 0);
    }

    // cap at 24: 40 well-separated hues
    const many = Array.from({ length: 40 }, (_, i) => ({
      color: `hsl(${i * 9}, 80%, ${30 + (i % 4) * 12}%)`,
      weight: 100 - i,
      usage: 'fill' as const,
    }));
    const capped = clusterColors(many);
    expect(capped.length).toBeLessThanOrEqual(24);
    expect(capped.length).toBeGreaterThan(10);
    expect(capped.reduce((s, t) => s + t.weight, 0)).toBeCloseTo(1, 9);
  });
});
