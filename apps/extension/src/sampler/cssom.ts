import { parseCssText } from '@specimen/core/cssText';
import type { RawPage } from '@specimen/core/schema';
import { mightBeStateSelector, propsOfRule, type StateRule, stateRulesFromText } from './states';

export type FetchCss = (urls: string[]) => Promise<(string | null)[]>;

export interface CssomResult {
  rootVars: RawPage['rootVars'];
  mediaQueries: string[];
  fontFaces: RawPage['fontFaces'];
  loadedFonts: string[];
  warnings: string[];
  /** Theme switches declared by the page: `class:dark`, `attr:data-theme=dark`, ... */
  darkSelectors: string[];
  lightSelectors: string[];
  prefersScheme: boolean;
  /** `:hover` / `:focus` / `:active` / `:disabled` rules (CSSOM plus fetched cross-origin text). */
  stateRules: StateRule[];
}

const ROOT_SEL = /(^|[\s,>+~])(:root|html|body)(?![\w-])/i;
const MAX_IMPORT_DEPTH = 5;
const MAX_CROSS_ORIGIN = 24;

interface Acc {
  varNames: Set<string>;
  media: Set<string>;
  fontFaces: RawPage['fontFaces'];
  fontKeys: Set<string>;
  blocked: Set<string>;
  dark: Set<string>;
  light: Set<string>;
  stateRules: StateRule[];
}

const MAX_STATE_RULES = 6000;

// A theme class/attribute only counts at the start of a selector or right after html/body/:root,
// so `.btn.dark` and Tailwind's escaped `.dark\:bg-black` are not mistaken for a theme switch.
const THEME_CLASS =
  /(?<=^|[\s,(>+~]|html|body|:root)\.(dark|dark-mode|dark-theme|theme-dark|light|light-mode|light-theme|theme-light)(?![\w\\-])/gi;
const THEME_ATTR =
  /\[\s*(data-theme|data-mode|data-color-mode|data-bs-theme|data-color-scheme|data-appearance)\s*=\s*["']?(dark|light)["']?\s*\]/gi;

function noteThemeSelectors(selector: string, acc: Acc): void {
  if (!/dark|light/i.test(selector)) return;
  for (const m of selector.matchAll(THEME_CLASS)) {
    const name = (m[1] ?? '').toLowerCase();
    (name.includes('dark') ? acc.dark : acc.light).add(`class:${name}`);
  }
  for (const m of selector.matchAll(THEME_ATTR)) {
    const value = (m[2] ?? '').toLowerCase();
    (value === 'dark' ? acc.dark : acc.light).add(`attr:${(m[1] ?? '').toLowerCase()}=${value}`);
  }
}

function matchesMedia(cond: string): boolean {
  try {
    return window.matchMedia(cond).matches;
  } catch {
    return false;
  }
}

function addFont(acc: Acc, f: RawPage['fontFaces'][number]): void {
  const key = `${f.family}|${f.weight ?? ''}|${f.style ?? ''}|${f.src}`;
  if (acc.fontKeys.has(key)) return;
  acc.fontKeys.add(key);
  acc.fontFaces.push(f);
}

function unquote(v: string): string {
  const t = v.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]
    ? t.slice(1, -1)
    : t;
}

function walkRules(
  rules: CSSRuleList,
  acc: Acc,
  depth: number,
  mediaOk = true,
  parent?: string,
): void {
  for (const rule of Array.from(rules)) {
    // Duck-typed on constructor to also work for rules from other realms.
    if (rule instanceof CSSStyleRule) {
      const sel = parent
        ? rule.selectorText.includes('&')
          ? rule.selectorText.replaceAll('&', `:is(${parent})`)
          : `${parent} ${rule.selectorText}`
        : rule.selectorText;
      noteThemeSelectors(sel, acc);
      if (mediaOk && acc.stateRules.length < MAX_STATE_RULES && mightBeStateSelector(sel)) {
        const props = propsOfRule(rule.style);
        if (Object.keys(props).length > 0) acc.stateRules.push({ selector: sel, props });
      }
      if (rule.cssRules?.length) walkRules(rule.cssRules, acc, depth, mediaOk, sel);
      if (
        ROOT_SEL.test(rule.selectorText) ||
        rule.selectorText.split(',').some((s) => ROOT_SEL.test(s))
      ) {
        const st = rule.style;
        for (let i = 0; i < st.length; i++) {
          const n = st.item(i);
          if (n.startsWith('--')) acc.varNames.add(n);
        }
      }
    } else if (rule instanceof CSSMediaRule) {
      const cond = rule.conditionText ?? rule.media.mediaText;
      if (cond) acc.media.add(cond.replace(/\s+/g, ' '));
      walkRules(rule.cssRules, acc, depth, mediaOk && (!cond || matchesMedia(cond)));
    } else if (rule instanceof CSSFontFaceRule) {
      const st = rule.style;
      const family = unquote(st.getPropertyValue('font-family'));
      if (family) {
        const f: RawPage['fontFaces'][number] = { family, src: st.getPropertyValue('src') };
        const w = st.getPropertyValue('font-weight');
        const s = st.getPropertyValue('font-style');
        if (w) f.weight = w;
        if (s) f.style = s;
        addFont(acc, f);
      }
    } else if (rule instanceof CSSImportRule) {
      if (depth >= MAX_IMPORT_DEPTH) continue;
      const media = rule.media?.mediaText;
      if (media && media !== 'all') acc.media.add(media.replace(/\s+/g, ' '));
      try {
        const inner = rule.styleSheet;
        if (inner) walkRules(inner.cssRules, acc, depth + 1, mediaOk);
        else if (rule.href) acc.blocked.add(rule.href);
      } catch {
        if (rule.href) acc.blocked.add(rule.href);
      }
    } else {
      // @supports, @layer, @container, ... — grouping rules with nested rules
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested && !(rule instanceof CSSKeyframesRule)) walkRules(nested, acc, depth, mediaOk);
    }
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function inlineVarNames(el: Element | null, acc: Acc): void {
  const st = (el as HTMLElement | null)?.style;
  if (!st) return;
  for (let i = 0; i < st.length; i++) {
    const n = st.item(i);
    if (n.startsWith('--')) acc.varNames.add(n);
  }
}

/** Collect rootVars, @media, @font-face and loaded fonts (CSSOM plus fetched cross-origin text). */
export async function collectCssom(fetchCss?: FetchCss): Promise<CssomResult> {
  const acc: Acc = {
    varNames: new Set(),
    media: new Set(),
    fontFaces: [],
    fontKeys: new Set(),
    blocked: new Set(),
    dark: new Set(),
    light: new Set(),
    stateRules: [],
  };
  const warnings: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walkRules(sheet.cssRules, acc, 0);
    } catch {
      if (sheet.href) acc.blocked.add(sheet.href);
    }
  }
  inlineVarNames(document.documentElement, acc);
  inlineVarNames(document.body, acc);

  // Cross-origin sheets the CSSOM refused to expose: ask the background for the text.
  const queue = [...acc.blocked].filter((u) => /^https?:/i.test(u));
  const seen = new Set<string>();
  for (let round = 0; round < MAX_IMPORT_DEPTH && queue.length > 0; round++) {
    const urls = queue
      .splice(0)
      .filter((u) => !seen.has(u))
      .slice(0, MAX_CROSS_ORIGIN);
    for (const u of urls) seen.add(u);
    if (urls.length === 0) break;
    let texts: (string | null)[] = [];
    if (fetchCss) {
      try {
        texts = await fetchCss(urls);
      } catch {
        texts = [];
      }
    }
    const skippedHosts = new Set<string>();
    urls.forEach((url, idx) => {
      const text = texts[idx];
      if (typeof text !== 'string') {
        skippedHosts.add(hostOf(url));
        return;
      }
      const parsed = parseCssText(text);
      for (const m of text.matchAll(/[^{}]*\{/g)) noteThemeSelectors(m[0], acc);
      if (acc.stateRules.length < MAX_STATE_RULES) acc.stateRules.push(...stateRulesFromText(text));
      for (const n of Object.keys(parsed.vars)) acc.varNames.add(n);
      for (const m of parsed.mediaQueries) acc.media.add(m);
      for (const f of parsed.fontFaces) addFont(acc, f);
      for (const imp of parsed.imports) {
        try {
          queue.push(new URL(imp, url).href);
        } catch {
          // unresolvable @import target
        }
      }
    });
    for (const h of skippedHosts) warnings.push(`cross-origin stylesheet skipped: ${h}`);
  }

  // Resolve every collected name against the live root so var() chains are flattened.
  const rootCs = getComputedStyle(document.documentElement);
  const bodyCs = getComputedStyle(document.body);
  const rootVars: Record<string, string> = {};
  for (const name of [...acc.varNames].sort()) {
    const v = rootCs.getPropertyValue(name).trim() || bodyCs.getPropertyValue(name).trim();
    if (v) rootVars[name] = v;
  }

  const loadedFonts: string[] = [];
  try {
    document.fonts.forEach((f) => {
      if (f.status === 'loaded') {
        const fam = unquote(f.family);
        if (!loadedFonts.includes(fam)) loadedFonts.push(fam);
      }
    });
  } catch {
    // document.fonts unavailable
  }

  return {
    rootVars,
    mediaQueries: [...acc.media],
    fontFaces: acc.fontFaces,
    loadedFonts,
    warnings: [...new Set(warnings)],
    darkSelectors: [...acc.dark].sort(),
    lightSelectors: [...acc.light].sort(),
    prefersScheme: [...acc.media].some((m) => /prefers-color-scheme/i.test(m)),
    stateRules: acc.stateRules,
  };
}
