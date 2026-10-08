import type { RawPage } from '@specimen/core/schema';
import { sampleComponents } from './components';
import { collectCssom, type FetchCss } from './cssom';
import { topBarHints } from './hints';
import { detectSections, toRawSections } from './sections';
import { applyTheme, settle } from './theme';
import { walkDom } from './walk';

export interface SampleOptions {
  /** Fetch cross-origin stylesheet text (background `css.fetch`). Null entries = skipped. */
  fetchCss?: FetchCss;
  /** Optional validator run on the result (zod in dev/tests); should throw when invalid. */
  validate?: (raw: RawPage) => void;
  /**
   * Re-sample with the page switched to this color scheme through its own class/attribute
   * switch (restored afterwards). `hints.themeApplied` reports whether anything changed.
   */
  theme?: 'dark' | 'light';
  /** Skip component specs and page hints (used for themed re-samples). */
  colorsOnly?: boolean;
  /** Skip only the component specs (the mobile capture needs the hints, not the states). */
  skipComponents?: boolean;
}

export type { FetchCss };

/** Sample the live page into a JSON-safe RawPage (ARCHITECTURE §4.1). */
export async function samplePage(opts: SampleOptions = {}): Promise<RawPage> {
  const fetchCss =
    opts.fetchCss ?? (globalThis as { __specimenFetchCss?: FetchCss }).__specimenFetchCss;
  const css = await collectCssom(fetchCss);

  let applied: ReturnType<typeof applyTheme> | undefined;
  if (opts.theme) {
    applied = applyTheme(opts.theme, { dark: css.darkSelectors, light: css.lightSelectors });
    if (applied.changed) await settle();
  }
  try {
    const de = document.documentElement;
    const vw = de.clientWidth || window.innerWidth;
    const docH = Math.max(de.scrollHeight, document.body.scrollHeight);
    const docW = Math.max(de.scrollWidth, document.body.scrollWidth);

    const cands = detectSections(vw, docH);
    const sectionRoots = new Map(cands.map((c, i) => [c.el, i] as const));
    const sections = toRawSections(cands);
    const walk = walkDom({ sectionRoots });

    const warnings = [...css.warnings];
    if (walk.truncated) {
      warnings.push(
        `sample cap reached: kept ${walk.samples.length} of ${walk.candidates} elements`,
      );
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
    if (opts.theme) raw.hints = { themeApplied: applied?.changed ?? false };
    if (!opts.colorsOnly) {
      if (!opts.skipComponents) {
        try {
          const components = sampleComponents(css.stateRules);
          if (components.length > 0) raw.components = components;
        } catch (e) {
          warnings.push(`components skipped: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      raw.hints = {
        ...topBarHints(),
        darkSelectors: css.darkSelectors,
        lightSelectors: css.lightSelectors,
        prefersScheme: css.prefersScheme,
      };
    }
    opts.validate?.(raw);
    return raw;
  } finally {
    applied?.restore();
  }
}
