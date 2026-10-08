import type { DesignScan } from '../schema';
import { type GeneratedFile, jsonOut, parseShadow, px } from './common';
import { flattenTokens } from './tokens';

type Tok = { $type: string; $value: unknown };

function names(stack: string): string[] {
  return stack
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** W3C Design Tokens (DTCG) JSON; Style Dictionary compatible. */
export function generateDtcg(scan: DesignScan): GeneratedFile {
  const t = flattenTokens(scan);
  const color: Record<string, Tok> = {};
  for (const c of t.colors) color[c.name] = { $type: 'color', $value: c.hex };

  const fontFamily: Record<string, Tok> = {
    display: { $type: 'fontFamily', $value: names(t.fonts.display) },
    body: { $type: 'fontFamily', $value: names(t.fonts.body) },
  };
  if (t.fonts.mono) fontFamily.mono = { $type: 'fontFamily', $value: names(t.fonts.mono) };

  const fontSize: Record<string, Tok> = {};
  const typography: Record<string, Tok> = {};
  for (const s of t.text) {
    fontSize[s.name] = { $type: 'dimension', $value: px(s.size) };
    const family = s.name === 'code' && t.fonts.mono ? t.fonts.mono : t.fonts.body;
    const isHeading = /^(display|h\d)$/.test(s.name);
    typography[s.name] = {
      $type: 'typography',
      $value: {
        fontFamily: names(isHeading ? t.fonts.display : family),
        fontSize: px(s.size),
        fontWeight: s.weight,
        letterSpacing: px(Math.round(s.letterSpacingEm * s.size * 100) / 100),
        lineHeight: s.lineHeight,
      },
    };
  }

  const space: Record<string, Tok> = {};
  t.space.forEach((v, i) => {
    space[String(i + 1)] = { $type: 'dimension', $value: px(v) };
  });

  const radius: Record<string, Tok> = {};
  for (const r of t.radii) radius[r.name] = { $type: 'dimension', $value: r.css };

  const shadow: Record<string, Tok> = {};
  for (const s of t.shadows) {
    const layers = parseShadow(s.css);
    if (!layers) continue;
    const value = layers.map((l) => ({
      color: l.color,
      offsetX: px(l.x),
      offsetY: px(l.y),
      blur: px(l.blur),
      spread: px(l.spread),
      ...(l.inset ? { inset: true } : {}),
    }));
    shadow[String(s.level)] = { $type: 'shadow', $value: value.length === 1 ? value[0] : value };
  }

  const out: Record<string, unknown> = { color, fontFamily, fontSize, typography, space, radius };
  if (Object.keys(shadow).length > 0) out.shadow = shadow;
  return { filename: 'tokens.json', mime: 'application/json', content: jsonOut(out) };
}
