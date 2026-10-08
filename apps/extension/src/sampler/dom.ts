import type { RawSection } from '@specimen/core/schema';

export type Landmark = NonNullable<RawSection['landmark']>;

export const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'LINK',
  'META',
  'HEAD',
  'TITLE',
  'BASE',
  'BR',
  'WBR',
]);

const ROLE_LANDMARKS: Record<string, Landmark> = {
  banner: 'header',
  navigation: 'nav',
  main: 'main',
  contentinfo: 'footer',
  complementary: 'aside',
};

export function landmarkOf(el: Element): Landmark | undefined {
  const role = el.getAttribute('role');
  if (role && ROLE_LANDMARKS[role]) return ROLE_LANDMARKS[role];
  switch (el.tagName) {
    case 'HEADER':
      return 'header';
    case 'NAV':
      return 'nav';
    case 'MAIN':
      return 'main';
    case 'FOOTER':
      return 'footer';
    case 'ASIDE':
      return 'aside';
  }
  return undefined;
}

/** Page-coordinate rect, rounded to integers. */
export function pageRect(el: Element): [number, number, number, number] {
  const r = el.getBoundingClientRect();
  return [
    Math.round(r.left + window.scrollX),
    Math.round(r.top + window.scrollY),
    Math.round(r.width),
    Math.round(r.height),
  ];
}

/**
 * True when the element (not its subtree) is invisible: display:none (also catches
 * `display: contents` boxes, which have no rect), visibility:hidden, zero area.
 */
export function isRenderedBox(el: Element, cs: CSSStyleDeclaration): boolean {
  if (cs.display === 'none' || cs.display === 'contents') return false;
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
