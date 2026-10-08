/**
 * Tiny CSS text parser for stylesheets the sampler cannot read through the CSSOM
 * (cross-origin sheets fetched by the background worker). Pure string work, no DOM.
 * It extracts only what the scan needs: root custom-property names/values,
 * `@media` conditions and `@font-face` descriptors.
 */

export interface ParsedFontFace {
  family: string;
  src: string;
  weight?: string;
  style?: string;
}

export interface ParsedCss {
  /** Custom properties declared on :root / html / body style rules (raw, unresolved). */
  vars: Record<string, string>;
  /** Condition text of every @media rule, including nested ones. */
  mediaQueries: string[];
  fontFaces: ParsedFontFace[];
  /** @import targets (raw url strings, unresolved). */
  imports: string[];
}

const ROOT_SELECTOR = /(^|[\s,>+~])(:root|html|body)(?![\w-])/i;
const CONTAINER_AT_RULES = new Set([
  'media',
  'supports',
  'layer',
  'container',
  'scope',
  'document',
]);

/** Remove comments, keeping string contents untouched. */
export function stripComments(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i] as string;
    if (c === '"' || c === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end;
    } else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function skipString(s: string, start: number): number {
  const q = s[start];
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === '\\') i += 2;
    else if (s[i] === q) return i + 1;
    else if (s[i] === '\n')
      return i; // unterminated string ends at newline
    else i++;
  }
  return s.length;
}

/** Index of the matching `}` for the `{` at `open` (or s.length when unbalanced). */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < s.length) {
    const c = s[i] as string;
    if (c === '"' || c === "'") {
      i = skipString(s, i);
      continue;
    }
    if (c === '(') {
      i = skipParens(s, i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return s.length;
}

function skipParens(s: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < s.length) {
    const c = s[i] as string;
    if (c === '"' || c === "'") {
      i = skipString(s, i);
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return s.length;
}

/** Split a declaration block body into [name, value] pairs on top-level `;`. */
export function parseDeclarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  let start = 0;
  let i = 0;
  const flush = (end: number) => {
    const decl = body.slice(start, end);
    const colon = decl.indexOf(':');
    if (colon > 0) {
      const name = decl.slice(0, colon).trim();
      const value = decl
        .slice(colon + 1)
        .replace(/!important\s*$/i, '')
        .trim();
      if (name) out.push([name, value]);
    }
  };
  while (i < body.length) {
    const c = body[i] as string;
    if (c === '"' || c === "'") i = skipString(body, i);
    else if (c === '(') i = skipParens(body, i);
    else if (c === '{')
      i = matchBrace(body, i) + 1; // nested rule: skip
    else if (c === ';') {
      flush(i);
      i++;
      start = i;
    } else i++;
  }
  flush(body.length);
  return out;
}

function unquote(v: string): string {
  const t = v.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]
    ? t.slice(1, -1)
    : t;
}

function parseImportTarget(prelude: string): string | null {
  const m = prelude.match(/^\s*(?:url\(\s*(["']?)(.*?)\1\s*\)|(["'])(.*?)\3)/i);
  if (!m) return null;
  return (m[2] ?? m[4] ?? '').trim() || null;
}

function walk(css: string, out: ParsedCss): void {
  let i = 0;
  while (i < css.length) {
    // Find the next `{` or `;` at top level — whichever ends the prelude.
    let j = i;
    while (j < css.length) {
      const c = css[j] as string;
      if (c === '"' || c === "'") j = skipString(css, j);
      else if (c === '(') j = skipParens(css, j);
      else if (c === '{' || c === ';' || c === '}') break;
      else j++;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= css.length) break;
    if (css[j] === '}') {
      i = j + 1;
      continue;
    }
    if (css[j] === ';') {
      // statement at-rule: @import / @charset / @namespace
      const imp = prelude.match(/^@import\s+([\s\S]*)$/i);
      if (imp) {
        const target = parseImportTarget(imp[1] as string);
        if (target) out.imports.push(target);
      }
      i = j + 1;
      continue;
    }
    // block
    const close = matchBrace(css, j);
    const body = css.slice(j + 1, close);
    i = close + 1;
    if (prelude.startsWith('@')) {
      const m = prelude.match(/^@([\w-]+)\s*([\s\S]*)$/);
      const name = (m?.[1] ?? '').toLowerCase();
      const rest = (m?.[2] ?? '').trim();
      if (name === 'media') {
        if (rest) out.mediaQueries.push(rest.replace(/\s+/g, ' '));
        walk(body, out);
      } else if (name === 'font-face') {
        const ff = fontFaceFrom(body);
        if (ff) out.fontFaces.push(ff);
      } else if (CONTAINER_AT_RULES.has(name)) {
        walk(body, out);
      }
      // other at-rules (@keyframes, @page, @property...) are ignored
    } else if (prelude && selectorHitsRoot(prelude)) {
      for (const [prop, value] of parseDeclarations(body)) {
        if (prop.startsWith('--')) out.vars[prop] = value;
      }
    }
    // Nested style rules (CSS nesting) are not followed; root vars live at top level.
  }
}

function selectorHitsRoot(selector: string): boolean {
  return selector.split(',').some((s) => ROOT_SELECTOR.test(s.trim()));
}

function fontFaceFrom(body: string): ParsedFontFace | null {
  let family = '';
  let src = '';
  let weight: string | undefined;
  let style: string | undefined;
  for (const [prop, value] of parseDeclarations(body)) {
    const p = prop.toLowerCase();
    if (p === 'font-family') family = unquote(value);
    else if (p === 'src') src = value;
    else if (p === 'font-weight') weight = value;
    else if (p === 'font-style') style = value;
  }
  if (!family) return null;
  const ff: ParsedFontFace = { family, src };
  if (weight) ff.weight = weight;
  if (style) ff.style = style;
  return ff;
}

export function parseCssText(text: string): ParsedCss {
  const out: ParsedCss = { vars: {}, mediaQueries: [], fontFaces: [], imports: [] };
  walk(stripComments(text), out);
  return out;
}
