import type { RawSample } from '@specimen/core/schema';
import { landmarkOf, pageRect, SKIP_TAGS } from './dom';
import { hasPaint, readStyles } from './styles';

export const SAMPLE_CAP = 4000;
/** Hard bound on elements inspected, so a 200k-node page can't blow the time budget. */
const VISIT_CAP = 40_000;
const SNIPPET_MAX = 60;

interface Candidate {
  el: Element;
  depth: number;
  rect: [number, number, number, number];
  textLen: number;
  tier: number;
  section: number;
  order: number;
}

export interface WalkOptions {
  cap?: number;
  /** Section root element → section index. Descendants inherit the index. */
  sectionRoots?: Map<Element, number>;
}

export interface WalkResult {
  samples: RawSample[];
  /** Elements inspected / visible candidates seen, for diagnostics and warnings. */
  visited: number;
  candidates: number;
  truncated: boolean;
}

function directTextLen(el: Element): number {
  let n = 0;
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) n += (c.nodeValue ?? '').trim().length;
  }
  return n;
}

function headingLevel(el: Element): RawSample['heading'] {
  const m = el.tagName.match(/^H([1-6])$/);
  if (m) return Number(m[1]) as RawSample['heading'];
  if (el.getAttribute('role') === 'heading') {
    const l = Number(el.getAttribute('aria-level'));
    if (l >= 1 && l <= 6) return l as RawSample['heading'];
  }
  return undefined;
}

function interactiveKind(el: Element, cs: CSSStyleDeclaration): RawSample['interactive'] {
  const tag = el.tagName;
  const role = el.getAttribute('role');
  if (tag === 'BUTTON' || role === 'button') return 'button';
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    return type === 'button' || type === 'submit' || type === 'reset' ? 'button' : 'input';
  }
  if (tag === 'SELECT') return 'select';
  if (tag === 'TEXTAREA') return 'textarea';
  if (tag === 'A' || role === 'link') {
    // <a> styled like a button: background or border, plus padding.
    const { bg, border } = hasPaint(cs);
    const padded =
      parseFloat(cs.paddingTop) > 0 ||
      parseFloat(cs.paddingBottom) > 0 ||
      parseFloat(cs.paddingLeft) > 0 ||
      parseFloat(cs.paddingRight) > 0;
    return (bg || border) && padded ? 'button' : 'link';
  }
  return undefined;
}

function snippet(el: Element): string | undefined {
  const raw =
    el.tagName === 'INPUT'
      ? (el as HTMLInputElement).value || el.getAttribute('aria-label') || ''
      : (el.textContent ?? '');
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > SNIPPET_MAX ? t.slice(0, SNIPPET_MAX) : t;
}

function isTextual(c: Candidate): boolean {
  const tag = c.el.tagName;
  return (
    c.textLen > 0 ||
    c.depth <= 1 ||
    tag === 'svg' ||
    tag === 'INPUT' ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    tag === 'BUTTON'
  );
}

/** Walk the visible DOM and record up to `cap` samples (priority: semantic > text > area). */
export function walkDom(opts: WalkOptions = {}): WalkResult {
  const cap = opts.cap ?? SAMPLE_CAP;
  const roots = opts.sectionRoots;
  const body = document.body;
  const docW = document.documentElement.scrollWidth;
  const docH = document.documentElement.scrollHeight;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  const cands: Candidate[] = [];
  const sectionStack: number[] = [];
  let depth = 0;
  let visited = 0;
  let order = 0;

  for (;;) {
    const el = walker.currentNode as Element;
    let enter = true;
    visited++;
    const sectionIdx = roots?.get(el);
    if (SKIP_TAGS.has(el.tagName)) {
      enter = false;
    } else {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.opacity === '0') {
        enter = false;
      } else {
        const r = el.getBoundingClientRect();
        const rendered =
          cs.display !== 'contents' &&
          cs.visibility !== 'hidden' &&
          cs.visibility !== 'collapse' &&
          r.width > 0 &&
          r.height > 0;
        const x = r.left + window.scrollX;
        const y = r.top + window.scrollY;
        const offscreen = x + r.width <= 0 || y + r.height <= 0 || x >= docW + 2000;
        const srOnly =
          (cs.position === 'absolute' || cs.position === 'fixed') &&
          r.width <= 1 &&
          r.height <= 1 &&
          cs.overflow !== 'visible';
        if (offscreen) enter = false;
        else if (rendered && !srOnly) {
          const textLen = directTextLen(el);
          const semantic =
            /^(H[1-6]|BUTTON|A|INPUT|SELECT|TEXTAREA|IMG|SVG|NAV|HEADER|FOOTER|MAIN|ASIDE)$/i.test(
              el.tagName,
            ) || el.hasAttribute('role');
          cands.push({
            el,
            depth,
            rect: pageRect(el),
            textLen,
            tier: semantic ? 3 : textLen > 0 ? 2 : 1,
            section: sectionIdx ?? sectionStack[sectionStack.length - 1] ?? -1,
            order: order++,
          });
        }
        if (el.tagName === 'svg') enter = false; // keep the <svg>, skip its internals
      }
    }
    if (enter && visited < VISIT_CAP && walker.firstChild()) {
      sectionStack.push(sectionIdx ?? sectionStack[sectionStack.length - 1] ?? -1);
      depth++;
      continue;
    }
    // Advance to the next sibling, climbing as needed.
    let done = false;
    for (;;) {
      if (walker.currentNode === body) {
        done = true;
        break;
      }
      if (visited >= VISIT_CAP) {
        done = true;
        break;
      }
      if (walker.nextSibling()) break;
      walker.parentNode();
      sectionStack.pop();
      depth--;
    }
    if (done) break;
  }

  // Prioritise when over the cap: tier, then visible area; then restore document order.
  let chosen = cands;
  const truncated = cands.length > cap;
  if (truncated) {
    chosen = [...cands]
      .sort((a, b) => b.tier - a.tier || b.rect[2] * b.rect[3] - a.rect[2] * a.rect[3])
      .slice(0, cap)
      .sort((a, b) => a.order - b.order);
  }

  const samples: RawSample[] = chosen.map((c, i) => {
    const cs = getComputedStyle(c.el);
    const s: RawSample = {
      i,
      tag: c.el.tagName.toLowerCase(),
      depth: c.depth,
      rect: c.rect,
      section: c.section,
      s: readStyles(cs, { textual: isTextual(c), rectWidth: c.rect[2] }),
    };
    const role = c.el.getAttribute('role');
    if (role) s.role = role;
    const heading = headingLevel(c.el);
    if (heading) s.heading = heading;
    const interactive = interactiveKind(c.el, cs);
    if (interactive) s.interactive = interactive;
    const landmark = landmarkOf(c.el);
    if (landmark) s.landmark = landmark;
    if (c.textLen > 0 || interactive) {
      const text: NonNullable<RawSample['text']> = { len: c.textLen };
      if (heading || interactive === 'button' || interactive === 'link') {
        const sn = snippet(c.el);
        if (sn) text.snippet = sn;
      }
      if (c.textLen > 0 || text.snippet) s.text = text;
    }
    return s;
  });
  return { samples, visited, candidates: cands.length, truncated };
}
