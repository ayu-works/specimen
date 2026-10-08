import type { RawSection } from '@specimen/core/schema';
import { isRenderedBox, landmarkOf, pageRect, SKIP_TAGS } from './dom';

export interface SectionCandidate {
  el: Element;
  rect: [number, number, number, number];
}

const MAX_DESCENT = 14;
/** Spacer-sized boxes (1px anchors, 2px dividers) never count as siblings or sections. */
const NEGLIGIBLE = 8;
/** A section shorter than this is a divider/ribbon, not a block of content. */
const MIN_SECTION_HEIGHT = 24;

/** In-flow, rendered element children (out-of-flow overlays don't define the page stack). */
function flowChildren(parent: Element): SectionCandidate[] {
  const out: SectionCandidate[] = [];
  for (const el of Array.from(parent.children)) {
    if (SKIP_TAGS.has(el.tagName) || el.tagName === 'svg') continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') continue;
    if (!isRenderedBox(el, cs)) continue;
    const rect = pageRect(el);
    if (rect[2] < NEGLIGIBLE || rect[3] < NEGLIGIBLE) continue;
    out.push({ el, rect });
  }
  return out;
}

function isStacked(items: SectionCandidate[]): boolean {
  const sorted = [...items].sort((a, b) => a.rect[1] - b.rect[1]);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as SectionCandidate;
    const cur = sorted[i] as SectionCandidate;
    if (cur.rect[1] < prev.rect[1] + prev.rect[3] - 2) return false; // vertical overlap
  }
  return true;
}

/** The stacked wide children at this level, or null when the level doesn't qualify. */
function qualifyingLevel(kids: SectionCandidate[], vw: number): SectionCandidate[] | null {
  const wide = kids.filter((k) => k.rect[2] >= vw * 0.8 && k.rect[3] >= MIN_SECTION_HEIGHT);
  if (wide.length < 3 || wide.length < kids.length * 0.6) return null;
  if (!isStacked(wide)) return null;
  return wide.sort((a, b) => a.rect[1] - b.rect[1]);
}

/**
 * Descend from `start` through single-meaningful-child wrappers until a level has >= 3
 * stacked, viewport-wide children. When a level instead holds one dominant block next to a
 * few siblings (`<main>` beside a footer), look inside the dominant block and keep the
 * wide siblings as sections of their own.
 */
function findLevel(start: Element, vw: number, depth = 0): SectionCandidate[] | null {
  if (depth > MAX_DESCENT) return null;
  const kids = flowChildren(start);
  const level = qualifyingLevel(kids, vw);
  if (level) return level;
  if (kids.length === 0) return null;
  if (kids.length === 1) return findLevel((kids[0] as SectionCandidate).el, vw, depth + 1);
  const parentH = pageRect(start)[3];
  const big = kids.reduce((a, b) => (b.rect[3] > a.rect[3] ? b : a));
  if (big.rect[2] >= vw * 0.8 && big.rect[3] >= parentH * 0.6) {
    const inner = findLevel(big.el, vw, depth + 1);
    if (inner) {
      const wide = (k: SectionCandidate) =>
        k.rect[2] >= vw * 0.8 && k.rect[3] >= MIN_SECTION_HEIGHT;
      const before = kids.filter((k) => k.rect[1] < big.rect[1] && wide(k));
      const after = kids.filter((k) => k.rect[1] > big.rect[1] && wide(k));
      return [...before, ...inner, ...after];
    }
  }
  return null;
}

const SEMANTIC_BLOCKS = new Set(['SECTION', 'HEADER', 'FOOTER', 'NAV', 'ARTICLE', 'ASIDE']);

/** `<main>` or a plain div that holds most of the page is itself a stack of sections. */
function isExpandable(c: SectionCandidate, docHeight: number): boolean {
  if (c.rect[3] < docHeight * 0.5) return false;
  if (SEMANTIC_BLOCKS.has(c.el.tagName)) return false;
  return c.el.tagName === 'MAIN' || c.el.tagName === 'DIV' || c.el.getAttribute('role') === 'main';
}

export function detectSections(vw: number, docHeight: number): SectionCandidate[] {
  const body = document.body;
  const level = findLevel(body, vw);
  if (!level) return [{ el: body, rect: pageRect(body) }];
  const expanded: SectionCandidate[] = [];
  for (const c of level) {
    const inner = isExpandable(c, docHeight) ? findLevel(c.el, vw) : null;
    if (inner) expanded.push(...inner);
    else expanded.push(c);
  }
  return expanded;
}

function gridColumns(cs: CSSStyleDeclaration): number | undefined {
  if (!cs.display.includes('grid')) return undefined;
  const t = cs.gridTemplateColumns;
  if (!t || t === 'none') return undefined;
  return t.split(/\s+/).filter(Boolean).length;
}

export function toRawSections(cands: SectionCandidate[]): RawSection[] {
  return cands.map((c, index) => {
    const cs = getComputedStyle(c.el);
    const s: RawSection = {
      index,
      rect: c.rect,
      tag: c.el.tagName.toLowerCase(),
      childCount: c.el.childElementCount,
    };
    const lm = landmarkOf(c.el);
    if (lm) s.landmark = lm;
    if (cs.display !== 'block') s.display = cs.display;
    const cols = gridColumns(cs);
    if (cols) s.gridColumns = cols;
    return s;
  });
}
