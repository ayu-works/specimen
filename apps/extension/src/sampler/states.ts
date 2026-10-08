import { stripComments } from '@specimen/core/cssText';
import { rgbaOf } from './colorUtil';

/** A style rule that mentions an interaction state, with the properties we care about. */
export interface StateRule {
  selector: string;
  props: Record<string, string>;
}

export type StateName = 'hover' | 'focus' | 'active' | 'disabled';

const KEEP = new Set([
  'background-color',
  'color',
  'border-color',
  'box-shadow',
  'outline',
  'outline-color',
  'outline-width',
  'outline-offset',
  'transform',
  'opacity',
  'text-decoration',
  'text-decoration-color',
  'filter',
]);
const LONGHAND_ALIAS: Record<string, string> = {
  'border-top-color': 'border-color',
  'text-decoration-line': 'text-decoration',
};
const SHORTHANDS = ['background', 'border', 'outline', 'text-decoration'] as const;

/** A selector worth keeping: it names one of the states (or a disabled attribute). */
const STATE_HINT =
  /:(hover|focus|focus-visible|active|disabled)\b|\[disabled\]|\[aria-disabled=["']?true["']?\]/i;

export function mightBeStateSelector(sel: string): boolean {
  return STATE_HINT.test(sel);
}

/**
 * Properties of a CSSOM style rule that we keep. Read by name (not by enumerating longhands) so
 * values containing `var()` survive: Chrome reports such shorthands only under their own name.
 */
export function propsOfRule(style: CSSStyleDeclaration): Record<string, string> {
  const props: Record<string, string> = {};
  for (const name of [...KEEP, ...SHORTHANDS]) {
    const v = style.getPropertyValue(name).trim();
    if (v) props[name] = v;
  }
  return props;
}

function parseDecls(body: string): Record<string, string> {
  const props: Record<string, string> = {};
  let depth = 0;
  let cur = '';
  const flush = () => {
    const i = cur.indexOf(':');
    if (i > 0) {
      const name = cur.slice(0, i).trim().toLowerCase();
      const value = cur.slice(i + 1).trim();
      const key = LONGHAND_ALIAS[name] ?? name;
      if (value && (KEEP.has(key) || (SHORTHANDS as readonly string[]).includes(key))) {
        props[key] = value;
      }
    }
    cur = '';
  };
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) flush();
    else cur += ch;
  }
  flush();
  return props;
}

function matchesMedia(cond: string): boolean {
  try {
    return window.matchMedia(cond).matches;
  } catch {
    return false;
  }
}

/** Find the `}` matching the `{` at `open`, skipping strings. Returns -1 when unbalanced. */
function closeOf(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      for (i++; i < css.length && css[i] !== c; i++) if (css[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

function walkText(css: string, out: StateRule[], depth: number): void {
  if (depth > 6) return;
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    const semi = css.indexOf(';', i);
    if (open === -1) break;
    if (semi !== -1 && semi < open && css.slice(i, semi).trim().startsWith('@')) {
      i = semi + 1; // @import / @charset / @layer a, b;
      continue;
    }
    const end = closeOf(css, open);
    if (end === -1) break;
    const prelude = css.slice(i, open).trim();
    const body = css.slice(open + 1, end);
    i = end + 1;
    if (prelude.startsWith('@')) {
      const at = /^@([\w-]+)\s*([\s\S]*)$/.exec(prelude);
      const name = at?.[1]?.toLowerCase();
      if (name === 'media') {
        if (matchesMedia((at?.[2] ?? '').trim())) walkText(body, out, depth + 1);
      } else if (
        name === 'supports' ||
        name === 'layer' ||
        name === 'container' ||
        name === 'scope'
      ) {
        walkText(body, out, depth + 1);
      }
    } else if (prelude && mightBeStateSelector(prelude)) {
      const props = parseDecls(body);
      if (Object.keys(props).length > 0) out.push({ selector: prelude, props });
    }
  }
}

/** State rules from raw CSS text (cross-origin sheets fetched by the background). */
export function stateRulesFromText(css: string): StateRule[] {
  const out: StateRule[] = [];
  try {
    walkText(stripComments(css), out, 0);
  } catch {
    /* malformed sheet: keep what we have */
  }
  return out;
}

// ---- matching -----------------------------------------------------------------------------

const PSEUDO: [StateName, RegExp][] = [
  ['hover', /:hover\b/gi],
  ['focus', /:focus-visible\b|:focus\b/gi],
  ['active', /:active\b/gi],
  ['disabled', /:disabled\b|\[disabled\]|\[aria-disabled=["']?true["']?\]/gi],
];

function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Approximate specificity (ids, classes/attrs/pseudos, tags) as one comparable number. */
function specificity(sel: string): number {
  const ids = (sel.match(/#[\w-]+/g) ?? []).length;
  const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const tags = (
    sel.replace(/\[[^\]]*\]|[.#:][\w-]+/g, ' ').match(/(^|[\s>+~(])[a-z][\w-]*/gi) ?? []
  ).length;
  return ids * 10_000 + cls * 100 + tags;
}

interface Prepared {
  state: StateName;
  /** Selector with the state removed; matches the element in its resting state. */
  rest: string;
  spec: number;
  order: number;
  props: Record<string, string>;
}

/** Strip the state out of every comma-separated selector; one `Prepared` per (selector, state). */
export function prepareRules(rules: StateRule[]): Prepared[] {
  const out: Prepared[] = [];
  rules.forEach((rule, order) => {
    for (const raw of splitSelectors(rule.selector)) {
      const sel = raw.replace(
        /:not\(\s*(?::disabled|\[disabled\]|\[aria-disabled=["']?true["']?\])\s*\)/gi,
        '',
      );
      if (
        sel.includes('::') ||
        /:not\([^)]*(?::hover|:focus|:active|:disabled|\[disabled\])/i.test(sel)
      )
        continue;
      for (const [state, re] of PSEUDO) {
        re.lastIndex = 0;
        if (!re.test(sel)) continue;
        re.lastIndex = 0;
        const rest =
          sel
            .replace(re, '')
            .replace(/:focus-within|:visited/gi, '')
            .trim() || '*';
        out.push({ state, rest, spec: specificity(sel), order, props: rule.props });
        break; // first state named wins when a selector names several
      }
    }
  });
  return out;
}

function resolveVars(value: string, cs: CSSStyleDeclaration): string {
  let v = value;
  for (let n = 0; n < 5 && v.includes('var('); n++) {
    v = v.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
      (_m, name: string, fb?: string) => {
        const got = cs.getPropertyValue(name).trim();
        return got || fb?.trim() || '';
      },
    );
  }
  return v.includes('var(') ? '' : v.trim();
}

const NOT_COLOR =
  /^(?:none|solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|thin|medium|thick|auto|initial|inherit|-?[\d.]+(?:px|em|rem|%)?)$/i;

function splitTop(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function colorToken(v: string): string | null {
  for (const t of splitTop(v)) {
    if (NOT_COLOR.test(t)) continue;
    if (rgbaOf(t)) return t;
  }
  return null;
}

/** Turn the raw, possibly shorthand declarations into the keys the core expects. */
function settle(props: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === 'background') {
      if (!/gradient\(|url\(/i.test(v)) {
        const c = colorToken(v);
        if (c) out['background-color'] ??= c;
      }
    } else if (k === 'border') {
      const c = colorToken(v);
      if (c) out['border-color'] ??= c;
    } else out[k] = v;
  }
  // Longhands win over shorthands that were read from the same rule.
  for (const [k, v] of Object.entries(props)) if (KEEP.has(k)) out[k] = v;
  return out;
}

/**
 * Declared state styles of `el`: every prepared rule whose state-free selector matches, applied
 * in specificity/source order. `var()` is resolved against the element's computed custom
 * properties. Only values that parse (colors) or are plain keywords/lengths are kept.
 */
export function statesOf(
  el: Element,
  prepared: Prepared[],
): Partial<Record<StateName, Record<string, string>>> {
  const cs = getComputedStyle(el);
  const hits = new Map<StateName, Prepared[]>();
  for (const p of prepared) {
    let ok = false;
    try {
      ok = el.matches(p.rest);
    } catch {
      ok = false;
    }
    if (ok) hits.set(p.state, [...(hits.get(p.state) ?? []), p]);
  }
  const out: Partial<Record<StateName, Record<string, string>>> = {};
  for (const [state, list] of hits) {
    const merged: Record<string, string> = {};
    for (const p of list.sort((a, b) => a.spec - b.spec || a.order - b.order)) {
      for (const [k, v] of Object.entries(p.props)) {
        const val = resolveVars(v.replace(/\s*!important\s*$/i, ''), cs);
        if (val && !/^(initial|inherit|unset|revert)$/i.test(val)) merged[k] = val;
      }
    }
    const settled = settle(merged);
    if (Object.keys(settled).length > 0) out[state] = settled;
  }
  return out;
}
