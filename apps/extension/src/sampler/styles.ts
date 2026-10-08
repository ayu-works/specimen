import { STYLE_KEYS, type StyleKey } from '@specimen/core/styleKeys';
import { BORDER_SIDES, DEFAULTS, INHERITED_TEXT_KEYS } from './defaults';

export type StyleMap = Partial<Record<StyleKey, string>>;

const BORDER_KEYS = new Set<string>(
  BORDER_SIDES.flatMap((s) => [`border${s}Color`, `border${s}Width`, `border${s}Style`]),
);
const INHERITED = new Set<StyleKey>(INHERITED_TEXT_KEYS);
const PLAIN_KEYS = STYLE_KEYS.filter((k) => !BORDER_KEYS.has(k));

export interface ReadStyleOptions {
  /** True when the element renders text (or is an svg/control): emit inherited type keys. */
  textual: boolean;
  /** Rounded border-box width in px; `width` is dropped when it just repeats the rect. */
  rectWidth: number;
}

function side(cs: CSSStyleDeclaration, s: (typeof BORDER_SIDES)[number]): [string, string, string] {
  const style = cs.getPropertyValue(`border-${s.toLowerCase()}-style`);
  const width = cs.getPropertyValue(`border-${s.toLowerCase()}-width`);
  if (style === 'none' || style === 'hidden' || width === '0px') return ['', '0px', 'none'];
  return [cs.getPropertyValue(`border-${s.toLowerCase()}-color`), width, style];
}

/** Read the StyleKey list from computed style, omitting defaults. */
export function readStyles(cs: CSSStyleDeclaration, opts: ReadStyleOptions): StyleMap {
  const out: StyleMap = {};
  for (const key of PLAIN_KEYS) {
    if (INHERITED.has(key) && !opts.textual) continue;
    const v = (cs as unknown as Record<string, string>)[key];
    if (v === undefined || v === '' || v === DEFAULTS[key]) continue;
    if (key === 'width' && v === `${opts.rectWidth}px`) continue;
    out[key] = v;
  }
  // Borders: top first; other sides only when they differ from the top triplet.
  const top = side(cs, 'Top');
  const hasTop = top[2] !== 'none';
  if (hasTop) {
    out.borderTopColor = top[0];
    out.borderTopWidth = top[1];
    out.borderTopStyle = top[2];
  }
  for (const s of BORDER_SIDES.slice(1)) {
    const t = side(cs, s);
    if (t[0] === top[0] && t[1] === top[1] && t[2] === top[2]) continue;
    out[`border${s}Color` as StyleKey] = t[0] || 'currentcolor';
    out[`border${s}Width` as StyleKey] = t[1];
    out[`border${s}Style` as StyleKey] = t[2];
  }
  return out;
}

/** Cheap check used by the walker/interactive classifier. */
export function hasPaint(cs: CSSStyleDeclaration): { bg: boolean; border: boolean } {
  const bg = cs.backgroundColor;
  const hasBg = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  const b = side(cs, 'Top');
  const hasBorder =
    b[2] !== 'none' && b[0] !== 'rgba(0, 0, 0, 0)' && b[0] !== 'transparent' && b[0] !== '';
  return { bg: hasBg, border: hasBorder };
}
