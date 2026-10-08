import type { DesignScan, Section } from '../schema';

const MIN_HEIGHT = 100;

/** Meaningful sections only: tiny spacer-like blocks are dropped (the nav may be short). */
export function usableSections(scan: DesignScan, max = 14): Section[] {
  const kept = scan.layout.blueprint.filter((s) => s.kind === 'nav' || s.height >= MIN_HEIGHT);
  return kept.slice(0, max);
}

function arrangementText(s: Section): string {
  switch (s.arrangement) {
    case 'stack':
      return 'single-column stack';
    case 'split':
      return 'two-column split (text beside media)';
    case 'grid':
      return s.columns >= 6
        ? 'multi-column grid of cards or tiles'
        : `${s.columns}-column grid of cards`;
    case 'bento':
      return 'bento grid of mixed-size tiles';
    case 'carousel':
      return 'horizontal carousel of items';
    case 'list':
      return 'vertical list of rows';
  }
}

const CONTENT: Record<Section['kind'], string> = {
  nav: 'top navigation: logo placeholder at left, a few text links, one primary button at right',
  hero: 'headline, short subcopy, two buttons and a product visual',
  logos: 'row of neutral placeholder logos',
  features: 'short heading and feature cards with icon, title and one line of copy',
  stats: 'a few large numbers with small labels',
  testimonials: 'quote cards with avatar placeholder and name',
  pricing: 'plan cards with price, feature list and a button',
  cta: 'closing headline with one primary button',
  faq: 'question and answer accordion',
  content: 'heading, supporting copy and media',
  footer: 'link columns, small print and social icons',
  unknown: 'heading, supporting copy and media',
};

/** Generic, copy-free description of a section. */
export function describeSection(s: Section): string {
  const align = s.align === 'center' ? 'centered' : 'left-aligned';
  const bg = s.bgRole ? `, ${s.bgRole} fill` : '';
  if (s.kind === 'nav') return `nav: ${CONTENT.nav}${bg}`;
  if (s.kind === 'hero' || s.kind === 'cta') {
    const shape =
      s.arrangement === 'split' ? 'two-column split (text beside visual)' : 'single-column stack';
    return `${s.kind}: ${align} ${shape} with ${CONTENT[s.kind]}${bg}`;
  }
  if (s.kind === 'footer') return `footer: ${CONTENT.footer}${bg}`;
  return `${s.kind}: ${align} ${arrangementText(s)} with ${CONTENT[s.kind]}${bg}`;
}
