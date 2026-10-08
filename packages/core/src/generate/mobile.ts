import type { DesignScan } from '../schema';
import { px, TYPE_ORDER } from './common';

type Mobile = NonNullable<NonNullable<DesignScan['variants']>['mobile']>;

/** Section kinds whose multi-column desktop layout becomes a single column on mobile. */
function stackedKinds(scan: DesignScan, m: Mobile): string[] {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  const mobile = m.blueprint ?? [];
  for (const d of scan.layout.blueprint) {
    const n = seen.get(d.kind) ?? 0;
    seen.set(d.kind, n + 1);
    const mm = mobile.filter((x) => x.kind === d.kind)[n];
    if (!mm || d.kind === 'nav' || d.kind === 'footer') continue;
    if (d.columns > 1 && mm.columns <= 1) out.add(d.kind);
    else if (d.arrangement === 'split' && mm.arrangement !== 'split') out.add(d.kind);
  }
  return [...out];
}

/** Plain-language bullet lines describing what changes on a phone; empty without a capture. */
export function mobileLines(scan: DesignScan): string[] {
  const m = scan.variants?.mobile;
  if (!m) return [];
  const lines: string[] = [];
  const stacked = stackedKinds(scan, m);
  lines.push(
    stacked.length > 0
      ? `- Stacking: ${stacked.join(', ')} collapse to a single column, with text above visuals.`
      : '- Stacking: keep a single-column flow; nothing needs to reflow differently from desktop.',
  );
  if (m.hamburger !== undefined) {
    lines.push(
      m.hamburger
        ? '- Navigation: collapse the top bar into a menu (hamburger) button and hide the inline links.'
        : '- Navigation: the top bar stays inline (no hamburger menu).',
    );
  }
  if (m.typeSizes) {
    const parts = TYPE_ORDER.flatMap((role) => {
      const to = m.typeSizes?.[role];
      const from = scan.typography.styles.find((s) => s.role === role)?.size;
      return to !== undefined && from !== undefined ? [`${role} ${from}px → ${to}px`] : [];
    });
    if (parts.length > 0) lines.push(`- Type sizes change: ${parts.join(', ')}.`);
  }
  const pad: string[] = [];
  if (m.sectionPaddingY && m.sectionPaddingY !== scan.spacing.sectionPaddingY) {
    pad.push(
      `section vertical padding ${px(scan.spacing.sectionPaddingY)} → ${px(m.sectionPaddingY)}`,
    );
  }
  if (m.gutter && m.gutter !== scan.layout.gutter) {
    pad.push(
      `side gutter ${scan.layout.gutter ? px(scan.layout.gutter) : 'fluid'} → ${px(m.gutter)}`,
    );
  }
  if (pad.length > 0) lines.push(`- Padding: ${pad.join(', ')}.`);
  return lines;
}

/** `## On mobile (≤ 390px)` section, or an empty string when no mobile capture exists. */
export function mobileSection(scan: DesignScan, heading = '## On mobile (≤ 390px)'): string {
  const lines = mobileLines(scan);
  return lines.length === 0 ? '' : [heading, '', ...lines].join('\n');
}
