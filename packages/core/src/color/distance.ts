import { converter } from 'culori';
import { parseColor, type Rgba } from './parse';

export interface Lab {
  l: number;
  a: number;
  b: number;
}

const toOklabConv = converter('oklab');
const toLabConv = converter('lab');

/** [L, a, b] in OKLab. */
export function toOklab(c: Rgba | string): [number, number, number] {
  const rgba = typeof c === 'string' ? parseColor(c) : c;
  if (!rgba) throw new Error(`Cannot convert to oklab: ${String(c)}`);
  const o = toOklabConv({ mode: 'rgb', r: rgba.r, g: rgba.g, b: rgba.b });
  return [o.l, o.a, o.b];
}

/**
 * CIEDE2000 on CIELAB values (Sharma, Wu & Dalal 2005). Implemented directly because
 * culori's built-in differs from the reference data by up to ~0.4 on the published pairs.
 */
export function deltaE2000Lab(x: Lab, y: Lab): number {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const c1 = Math.hypot(x.a, x.b);
  const c2 = Math.hypot(y.a, y.b);
  const cBar7 = ((c1 + c2) / 2) ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1p = (1 + g) * x.a;
  const a2p = (1 + g) * y.a;
  const c1p = Math.hypot(a1p, x.b);
  const c2p = Math.hypot(a2p, y.b);
  const hue = (b: number, a: number) => {
    if (b === 0 && a === 0) return 0;
    const h = Math.atan2(b, a) * deg;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(x.b, a1p);
  const h2p = hue(y.b, a2p);

  const dLp = y.l - x.l;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * rad) / 2);

  const lBarP = (x.l + y.l) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hBarP = (h1p + h2p) / 2;
    else hBarP = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBarP - 30) * rad) +
    0.24 * Math.cos(2 * hBarP * rad) +
    0.32 * Math.cos((3 * hBarP + 6) * rad) -
    0.2 * Math.cos((4 * hBarP - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt(
    (dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh),
  );
}

/** CIEDE2000 between two CSS colors / RGBA values (alpha ignored). */
export function deltaE2000(x: Rgba | string, y: Rgba | string): number {
  const toLab = (c: Rgba | string): Lab => {
    const rgba = typeof c === 'string' ? parseColor(c) : c;
    if (!rgba) throw new Error(`Cannot compute deltaE for: ${String(c)}`);
    const { l, a, b } = toLabConv({ mode: 'rgb', r: rgba.r, g: rgba.g, b: rgba.b });
    return { l, a, b };
  };
  return deltaE2000Lab(toLab(x), toLab(y));
}
