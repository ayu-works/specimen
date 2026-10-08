import type { ColorRole, DesignScan, RawPage } from '../schema';
import type { SampleColors } from './colors';
import { bump, ranked, round } from './util';

export type Borders = DesignScan['borders'];

export function extractBorders(
  _raw: RawPage,
  perSample: SampleColors[],
  roleOf: (hex: string) => ColorRole | undefined,
): Borders {
  const weights = new Map<string, number>();
  for (const c of perSample) {
    for (const b of c.borders)
      bump(weights, `${Math.round(b.width * 2) / 2}|${roleOf(b.hex) ?? ''}`, b.length * b.width);
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  return ranked(weights)
    .slice(0, 5)
    .map(([k, w]) => {
      const [width, role] = k.split('|') as [string, string];
      const out: Borders[number] = { width: Number(width), weight: round(w / total, 4) };
      if (role) out.colorRole = role as ColorRole;
      return out;
    });
}
