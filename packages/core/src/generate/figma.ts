import { parseColor } from '../color';
import type { DesignScan } from '../schema';
import { type GeneratedFile, jsonOut } from './common';
import { flattenTokens } from './tokens';

/**
 * Figma Variables import JSON (the shape commonly used by variable-import plugins):
 *
 * {
 *   "collections": [
 *     {
 *       "name": "Specimen",
 *       "modes": ["Light"],
 *       "variables": [
 *         { "name": "color/accent", "type": "COLOR",
 *           "values": { "Light": { "r": 0-1, "g": 0-1, "b": 0-1, "a": 0-1 } } },
 *         { "name": "radius/button", "type": "FLOAT", "values": { "Light": 8 } },
 *         { "name": "font/body", "type": "STRING", "values": { "Light": "Inter, sans-serif" } }
 *       ]
 *     }
 *   ]
 * }
 *
 * Names use "/" to create Figma variable groups. Lengths are unitless pixels (FLOAT).
 */
interface FigmaVariable {
  name: string;
  type: 'COLOR' | 'FLOAT' | 'STRING';
  values: Record<string, unknown>;
}

const MODE = 'Light';
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function generateFigma(scan: DesignScan): GeneratedFile {
  const t = flattenTokens(scan);
  const vars: FigmaVariable[] = [];
  for (const c of t.colors) {
    const rgba = parseColor(c.hex);
    if (!rgba) continue;
    vars.push({
      name: `color/${c.name}`,
      type: 'COLOR',
      values: { [MODE]: { r: r4(rgba.r), g: r4(rgba.g), b: r4(rgba.b), a: r4(rgba.alpha) } },
    });
  }
  vars.push({ name: 'font/display', type: 'STRING', values: { [MODE]: t.fonts.display } });
  vars.push({ name: 'font/body', type: 'STRING', values: { [MODE]: t.fonts.body } });
  if (t.fonts.mono)
    vars.push({ name: 'font/mono', type: 'STRING', values: { [MODE]: t.fonts.mono } });
  for (const s of t.text) {
    vars.push({ name: `text/${s.name}/size`, type: 'FLOAT', values: { [MODE]: s.size } });
    vars.push({ name: `text/${s.name}/weight`, type: 'FLOAT', values: { [MODE]: s.weight } });
    vars.push({
      name: `text/${s.name}/line-height`,
      type: 'FLOAT',
      values: { [MODE]: s.lineHeight },
    });
  }
  t.space.forEach((v, i) => {
    vars.push({ name: `space/${i + 1}`, type: 'FLOAT', values: { [MODE]: v } });
  });
  for (const r of t.radii) {
    vars.push({ name: `radius/${r.name}`, type: 'FLOAT', values: { [MODE]: r.value } });
  }
  return {
    filename: 'figma-variables.json',
    mime: 'application/json',
    content: jsonOut({ collections: [{ name: 'Specimen', modes: [MODE], variables: vars }] }),
  };
}
