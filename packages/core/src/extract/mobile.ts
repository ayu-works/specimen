import type { DesignScan, RawPage } from '../schema';
import { extract } from './index';

type Mobile = NonNullable<NonNullable<DesignScan['variants']>['mobile']>;

/**
 * Extract a phone-width `RawPage` into the `variants.mobile` partial: the mobile layout
 * (blueprint, container, gutter, density) plus the type sizes and section padding that
 * differ from `desktop`, and whether the nav collapses to a menu button.
 */
export function extractMobile(raw: RawPage, desktop: DesignScan): Mobile {
  const m = extract(raw, { validate: false, id: 'mobile' });
  const typeSizes: Record<string, number> = {};
  for (const s of m.typography.styles) {
    const d = desktop.typography.styles.find((x) => x.role === s.role);
    if (d && Math.abs(d.size - s.size) >= 1) typeSizes[s.role] = s.size;
  }
  const out: Mobile = {
    containerMaxWidth: m.layout.containerMaxWidth,
    gutter: m.layout.gutter,
    density: m.layout.density,
    blueprint: m.layout.blueprint,
    viewportWidth: raw.viewport.w,
  };
  if (Object.keys(typeSizes).length > 0) out.typeSizes = typeSizes;
  if (m.spacing.sectionPaddingY > 0) out.sectionPaddingY = m.spacing.sectionPaddingY;
  if (raw.hints?.hamburger !== undefined) out.hamburger = raw.hints.hamburger;
  return out;
}
