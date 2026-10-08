import { computeA11y } from '../a11y';
import { type DesignScan, DesignScanSchema, type RawPage } from '../schema';
import { extractBorders } from './borders';
import { analyzeColors, type ColorOptions, CSS_VAR_HINT } from './colors';
import { extractComponents } from './components';
import { densityOf, extractLayout } from './layout';
import { extractRadii } from './radii';
import { classifySections } from './sections';
import { extractShadows } from './shadows';
import { extractSpacing } from './spacing';
import { extractTypography } from './typography';

export const EXTRACTOR_VERSION = '1.1.0';

export { mergeScans } from './merge';
export { extractMobile } from './mobile';

export interface ExtractOptions extends ColorOptions {
  /** Override the scan id (default: derived from url + scannedAt). */
  id?: string;
  /** Skip zod validation of the result (default: validate). */
  validate?: boolean;
}

const VAR_NAME = new RegExp(
  `${CSS_VAR_HINT.source}|color|radius|shadow|space|spacing|font|text|size|gap|surface|container|width|line|weight|tracking`,
  'i',
);

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function designVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(vars).sort(([a], [b]) => a.localeCompare(b))) {
    if (!VAR_NAME.test(k) || v.length > 200) continue;
    out[k] = v;
    if (++n >= 200) break;
  }
  return out;
}

/** RawPage -> DesignScan (ARCHITECTURE §5). Deterministic apart from `durationMs`. */
export function extract(raw: RawPage, opts: ExtractOptions = {}): DesignScan {
  const t0 = performance.now();
  const colors = analyzeColors(raw, { neutralThreshold: 0.8, ...opts });
  const typography = extractTypography(raw);
  const spacing = extractSpacing(raw);
  const bgOf = (i: number) => colors.perSample[i]?.ownBg;
  const radii = extractRadii(raw, colors.pageBg, bgOf);
  const shadows = extractShadows(raw);
  const borders = extractBorders(raw, colors.perSample, colors.roleOf);
  const layout = extractLayout(raw);
  const blueprint = classifySections({
    raw,
    perSample: colors.perSample,
    roleOf: colors.roleOf,
    styles: typography.styles,
    baseSize: typography.baseSize,
  });
  let host = raw.url;
  try {
    host = new URL(raw.url).host;
  } catch {
    /* keep raw */
  }
  const scan: DesignScan = {
    schemaVersion: 3,
    id: opts.id ?? `scan_${hash(`${raw.url}|${raw.scannedAt}`)}`,
    url: raw.url,
    host,
    title: raw.title,
    scannedAt: raw.scannedAt,
    viewport: { w: raw.viewport.w, h: raw.viewport.h },
    colorScheme: raw.colorScheme,
    colors: colors.colors,
    typography,
    spacing,
    radii,
    shadows,
    borders,
    layout: {
      ...layout,
      density: densityOf(spacing.sectionPaddingY, typography.baseSize),
      blueprint,
    },
    a11y: computeA11y(colors.colors),
    cssVariables: designVars(raw.rootVars),
    meta: {
      extractorVersion: EXTRACTOR_VERSION,
      sampleCount: raw.samples.length,
      durationMs: Math.round((performance.now() - t0) * 10) / 10,
      warnings: [...raw.warnings],
    },
  };
  const components = extractComponents(raw.components);
  if (components.length > 0) scan.components = components;
  return opts.validate === false ? scan : DesignScanSchema.parse(scan);
}
