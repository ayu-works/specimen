import type { RawHints } from '@specimen/core/schema';

const TOP_BAR_MAX_Y = 160;
const MENU_NAME = /menu|burger|hamburger|nav-?toggle|toggle-?nav|drawer/i;

function visible(el: Element): DOMRect | null {
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/** Visible links in the top bar, and whether a menu button (hamburger) is showing there. */
export function topBarHints(): Pick<RawHints, 'hamburger' | 'navLinks'> {
  const scope = document.querySelectorAll('header, nav, [role="banner"], [role="navigation"]');
  let links = 0;
  let hamburger = false;
  const seen = new Set<Element>();
  for (const root of scope) {
    const rr = root.getBoundingClientRect();
    if (rr.top > TOP_BAR_MAX_Y) continue;
    for (const a of root.querySelectorAll('a[href]')) {
      if (seen.has(a)) continue;
      seen.add(a);
      const r = visible(a);
      if (r && r.top < TOP_BAR_MAX_Y && (a.textContent ?? '').trim().length > 0) links++;
    }
    for (const b of root.querySelectorAll('button, [role="button"], a, summary, label')) {
      if (hamburger) break;
      const r = visible(b);
      if (!r || r.top > TOP_BAR_MAX_Y || r.width > 72 || r.height > 72) continue;
      const text = (b.textContent ?? '').trim();
      if (text.length > 10) continue;
      const hint = [
        b.getAttribute('aria-label'),
        b.getAttribute('aria-controls'),
        b.getAttribute('title'),
        b.id,
        typeof b.className === 'string' ? b.className : '',
        text,
      ]
        .filter(Boolean)
        .join(' ');
      if (MENU_NAME.test(hint) || (b.hasAttribute('aria-expanded') && b.querySelector('svg'))) {
        hamburger = true;
      }
    }
  }
  return { hamburger, navLinks: links };
}
