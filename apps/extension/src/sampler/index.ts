import type { RawPage } from '@specimen/core/schema';
import { collectCssom, type FetchCss } from './cssom';
import { detectSections, toRawSections } from './sections';
import { walkDom } from './walk';

export interface SampleOptions {
  /** Fetch cross-origin stylesheet text (background `css.fetch`). Null entries = skipped. */
  fetchCss?: FetchCss;
  /** Optional validator run on the result (zod in dev/tests); should throw when invalid. */
  validate?: (raw: RawPage) => void;
}

export type { FetchCss };

/** Sample the live page into a JSON-safe RawPage (ARCHITECTURE §4.1). */
export async function samplePage(opts: SampleOptions = {}): Promise<RawPage> {
  const fetchCss =
    opts.fetchCss ?? (globalThis as { __specimenFetchCss?: FetchCss }).__specimenFetchCss;
  const de = document.documentElement;
  const vw = de.clientWidth || window.innerWidth;
  const docH = Math.max(de.scrollHeight, document.body.scrollHeight);
  const docW = Math.max(de.scrollWidth, document.body.scrollWidth);

  const cands = detectSections(vw, docH);
  const sectionRoots = new Map(cands.map((c, i) => [c.el, i] as const));
  const sections = toRawSections(cands);
  const walk = walkDom({ sectionRoots });
  const css = await collectCssom(fetchCss);

  const warnings = [...css.warnings];
  if (walk.truncated) {
    warnings.push(`sample cap reached: kept ${walk.samples.length} of ${walk.candidates} elements`);
  }

  const raw: RawPage = {
    url: location.href,
    title: document.title,
    scannedAt: Date.now(),
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    doc: { w: docW, h: docH },
    colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    canvasBg: getComputedStyle(de).backgroundColor,
    rootVars: css.rootVars,
    mediaQueries: css.mediaQueries,
    fontFaces: css.fontFaces,
    loadedFonts: css.loadedFonts,
    samples: walk.samples,
    sections,
    warnings,
  };
  opts.validate?.(raw);
  return raw;
}
