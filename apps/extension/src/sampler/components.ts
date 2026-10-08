import type { RawComponent } from '@specimen/core/schema';
import { distance, hexOf, over, type Rgba, rgbaOf, saturation } from './colorUtil';
import { SKIP_TAGS } from './dom';
import { prepareRules, type StateRule, statesOf } from './states';

type Kind = RawComponent['kind'];

const REPS_PER_KIND = 3;
const MAX_BUTTONS = 90;
const MAX_INPUTS = 24;
const MAX_NAV_LINKS = 40;
const MAX_SCAN = 2500;
const WHITE: Rgba = [255, 255, 255, 1];

const px = (v: string): number => Number.parseFloat(v) || 0;

function visibleRect(el: Element, cs: CSSStyleDeclaration): DOMRect | null {
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return null;
  const r = el.getBoundingClientRect();
  return r.width >= 4 && r.height >= 4 ? r : null;
}

/** Background the element is painted on: the nearest opaque ancestor background. */
function paintedOn(el: Element): Rgba {
  const chain: Rgba[] = [];
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    const c = rgbaOf(getComputedStyle(cur).backgroundColor);
    if (c && c[3] > 0) {
      chain.push(c);
      if (c[3] >= 1) break;
    }
  }
  let base = WHITE;
  for (const c of chain.reverse()) base = over(c, base);
  return base;
}

interface Info {
  el: Element;
  cs: CSSStyleDeclaration;
  rect: DOMRect;
  bg: Rgba;
  on: Rgba;
  filled: boolean;
  hasBorder: boolean;
  /** Style signature: elements with the same one are instances of one component. */
  sig: string;
}

function infoOf(el: Element): Info | null {
  const cs = getComputedStyle(el);
  const rect = visibleRect(el, cs);
  if (!rect) return null;
  const on = paintedOn(el);
  const raw = rgbaOf(cs.backgroundColor) ?? [0, 0, 0, 0];
  const bg = raw[3] > 0 ? over(raw, on) : on;
  const filled = raw[3] >= 0.6 && distance(bg, on) > 12;
  const bw = px(cs.borderTopWidth);
  const bc = rgbaOf(cs.borderTopColor);
  const hasBorder = bw >= 1 && cs.borderTopStyle !== 'none' && !!bc && bc[3] > 0.3;
  const sig = [
    filled ? hexOf(bg) : 'none',
    hasBorder ? cs.borderTopColor : 'none',
    cs.borderTopLeftRadius,
    cs.fontSize,
    cs.fontWeight,
    cs.color,
  ].join('|');
  return { el, cs, rect, bg, on, filled, hasBorder, sig };
}

/** Computed style properties recorded for a representative (kebab-case, no defaults). */
function baseOf(i: Info): Record<string, string> {
  const { cs, rect } = i;
  const out: Record<string, string> = {};
  const bg = rgbaOf(cs.backgroundColor);
  out['background-color'] = bg && bg[3] > 0 ? hexOf(bg) : 'transparent';
  const color = rgbaOf(cs.color);
  if (color) out.color = hexOf(color);
  const bw = px(cs.borderTopWidth);
  if (i.hasBorder) {
    out['border-width'] = `${bw}px`;
    const bc = rgbaOf(cs.borderTopColor);
    if (bc) out['border-color'] = hexOf(bc);
  } else out['border-width'] = '0px';
  out['border-radius'] = cs.borderTopLeftRadius;
  const [pt, pr, pb, pl] = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft];
  out.padding =
    pt === pb && pr === pl ? (pt === pr ? pt : `${pt} ${pr}`) : `${pt} ${pr} ${pb} ${pl}`;
  out['font-size'] = cs.fontSize;
  out['font-weight'] = cs.fontWeight;
  if (cs.boxShadow && cs.boxShadow !== 'none') out['box-shadow'] = cs.boxShadow;
  out.height = `${Math.round(rect.height)}px`;
  return out;
}

/** The most common signature among `infos`, with up to `n` of its elements. */
function topGroup(infos: Info[], n = REPS_PER_KIND): Info[] {
  const groups = new Map<string, Info[]>();
  for (const i of infos) groups.set(i.sig, [...(groups.get(i.sig) ?? []), i]);
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  return best.slice(0, n);
}

function isPaddedLink(i: Info): boolean {
  return (
    (i.filled || i.hasBorder) &&
    (px(i.cs.paddingLeft) > 0 || px(i.cs.paddingTop) > 0) &&
    (i.el.textContent ?? '').trim().length > 0
  );
}

function buttonCandidates(): Info[] {
  const els = document.querySelectorAll(
    'button, [role="button"], input[type="button"], input[type="submit"], a[href]',
  );
  const out: Info[] = [];
  for (const el of els) {
    if (out.length >= MAX_BUTTONS) break;
    if (el.closest('[aria-hidden="true"]')) continue;
    const i = infoOf(el);
    if (!i) continue;
    const label = ((el as HTMLInputElement).value || el.textContent || '').trim();
    if (!label) continue;
    if (el.tagName === 'A' && !isPaddedLink(i)) continue;
    if (i.rect.height > 120 || i.rect.width > 520) continue;
    out.push(i);
  }
  return out;
}

function classifyButtons(buttons: Info[]): { primary: Info[]; secondary: Info[]; ghost: Info[] } {
  const filled = buttons.filter((b) => b.filled);
  const outline = buttons.filter((b) => !b.filled && b.hasBorder);
  const ghost = buttons.filter((b) => !b.filled && !b.hasBorder && b.el.tagName !== 'A');

  // Primary: the filled group that is most common and most colorful (monochrome sites: most contrasting).
  const byBg = new Map<string, Info[]>();
  for (const b of filled) byBg.set(hexOf(b.bg), [...(byBg.get(hexOf(b.bg)) ?? []), b]);
  const score = (g: Info[]) => {
    const first = g[0] as Info;
    return g.length * (1 + 2 * saturation(first.bg)) + distance(first.bg, first.on) / 255;
  };
  const groups = [...byBg.values()].sort((a, b) => score(b) - score(a));
  const primary = groups[0] ?? [];
  const otherFilled = groups.slice(1).flat();
  const secondary = outline.length > 0 ? outline : otherFilled;
  return { primary: topGroup(primary), secondary: topGroup(secondary), ghost: topGroup(ghost) };
}

function inputCandidates(): Info[] {
  const els = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="file"]):not([type="image"]):not([type="color"]), textarea, select',
  );
  const out: Info[] = [];
  for (const el of els) {
    if (out.length >= MAX_INPUTS) break;
    const i = infoOf(el);
    if (i) out.push(i);
  }
  return out;
}

function navLinkCandidates(): Info[] {
  const els = document.querySelectorAll('nav a[href], header a[href], [role="navigation"] a[href]');
  const out: Info[] = [];
  for (const el of els) {
    if (out.length >= MAX_NAV_LINKS) break;
    const i = infoOf(el);
    if (!i || i.filled || i.hasBorder) continue;
    const text = (el.textContent ?? '').trim();
    if (text.length === 0 || text.length > 28) continue;
    out.push(i);
  }
  return out;
}

/** Card-like boxes (as the extractor sees them) and small pill labels (badges), in one pass. */
function boxCandidates(): { cards: Info[]; badges: Info[] } {
  const cards: Info[] = [];
  const badges: Info[] = [];
  let n = 0;
  for (const el of document.body.querySelectorAll('div, article, li, section, span, a, p, small')) {
    if (++n > MAX_SCAN) break;
    if (SKIP_TAGS.has(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    const isCard = r.width >= 160 && r.height >= 60 && r.width <= 720 && r.height <= 640;
    const isBadge = r.width >= 14 && r.width <= 180 && r.height >= 12 && r.height <= 38;
    if (!isCard && !isBadge) continue;
    const cs = getComputedStyle(el);
    if (px(cs.borderTopLeftRadius) <= 0) continue;
    const i = infoOf(el);
    if (!i) continue;
    if (isCard) {
      const decorated = i.filled || i.hasBorder || (cs.boxShadow && cs.boxShadow !== 'none');
      if (decorated && !el.matches('a, button, [role="button"]') && cards.length < 80)
        cards.push(i);
    } else {
      const text = (el.textContent ?? '').trim();
      const plain = el.children.length <= 1 && text.length > 0 && text.length <= 24;
      if (
        plain &&
        i.filled &&
        !el.closest('button, [role="button"], a[href], input') &&
        badges.length < 40
      ) {
        badges.push(i);
      }
    }
  }
  return { cards, badges };
}

/**
 * Representative components with their base styles and the interaction states the page's own
 * CSS declares (no input is simulated). Core merges the representatives per kind.
 */
export function sampleComponents(stateRules: StateRule[]): RawComponent[] {
  const prepared = prepareRules(stateRules);
  const out: RawComponent[] = [];
  const add = (kind: Kind, infos: Info[]) => {
    for (const i of infos) out.push({ kind, base: baseOf(i), states: statesOf(i.el, prepared) });
  };

  const { primary, secondary, ghost } = classifyButtons(buttonCandidates());
  add('button-primary', primary);
  add('button-secondary', secondary);
  add('button-ghost', ghost);
  add('input', topGroup(inputCandidates()));
  add('nav-link', topGroup(navLinkCandidates()));
  const { cards, badges } = boxCandidates();
  add('card', topGroup(cards));
  add('badge', topGroup(badges));
  return out;
}
