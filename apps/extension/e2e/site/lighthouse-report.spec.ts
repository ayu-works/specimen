// T7.02 report logic: medians, the pass bar and the warnings of lighthouse-report.ts, on hand-made LHRs.
// The Lighthouse measurement itself is the non-blocking CI job (lighthouse.yml); it is not part of the gate.
// Offline: no browser, no server, no network.
import { expect, test } from '@playwright/test';
import {
  CATEGORIES,
  FONTS_WARNING,
  type Lhr,
  median,
  summarize,
  toMarkdown,
  verdict,
} from './lighthouse-report';

const ORIGIN = 'http://127.0.0.1:4000';
const PAGES = ['/', '/privacy/'];
const FONT_A = `${ORIGIN}/fonts/pressstart2p-regular.woff2`;
const FONT_FILE = `${ORIGIN}/fonts/vt323-latin.woff2`;

function lhr(
  page: string,
  scores: Partial<Record<string, number | null>> = {},
  extra: Partial<Lhr> = {},
  requests = [
    { url: `${ORIGIN}${page}`, statusCode: 200, resourceType: 'Document' },
    { url: FONT_A, statusCode: 200, resourceType: 'Font' },
    { url: FONT_FILE, statusCode: 200, resourceType: 'Font' },
  ],
): Lhr {
  const categories: Lhr['categories'] = {};
  for (const c of CATEGORIES) categories[c] = { score: c in scores ? (scores[c] ?? null) : 1 };
  return {
    requestedUrl: `${ORIGIN}${page}`,
    categories,
    audits: { 'network-requests': { details: { items: requests } } },
    ...extra,
  };
}

const threeEach = (scores: Partial<Record<string, number | null>> = {}) =>
  PAGES.flatMap((p) => [lhr(p, scores), lhr(p, scores), lhr(p, scores)]);

test.describe('T7.02 report', () => {
  test('T7.02 report: median of 3 runs per page and category', () => {
    expect(median([0.9, 0.7, 0.8])).toBe(0.8);
    expect(median([1, 0.5, 0.99, 0.2])).toBeCloseTo(0.745);
    const lhrs = [
      lhr('/', { performance: 0.99 }),
      lhr('/privacy/', { performance: 0.5 }),
      lhr('/', { performance: 0.9 }),
      lhr('/', { performance: 0.97 }),
      lhr('/privacy/', { performance: 0.96 }),
      lhr('/privacy/', { performance: 0.98 }),
    ];
    const [home, privacy] = summarize(lhrs, PAGES);
    expect(home?.categories.find((c) => c.category === 'performance')?.median).toBe(0.97);
    expect(privacy?.categories.find((c) => c.category === 'performance')?.median).toBe(0.96);
    expect(verdict(summarize(lhrs, PAGES))).toEqual([]);
  });

  test('T7.02 report: a category under the bar fails and names page and category', () => {
    const lhrs = threeEach().map((l) =>
      l.requestedUrl?.endsWith('/privacy/')
        ? { ...l, categories: { ...l.categories, seo: { score: 0.94 } } }
        : l,
    );
    expect(verdict(summarize(lhrs, PAGES))).toEqual(['/privacy/: seo 0.940 < 0.95']);
  });

  test('T7.02 report: 0.949 fails; the bar is the raw score, not the rounded 95', () => {
    const results = summarize(threeEach({ performance: 0.949 }), PAGES);
    expect(verdict(results)).toEqual([
      '/: performance 0.949 < 0.95',
      '/privacy/: performance 0.949 < 0.95',
    ]);
    expect(toMarkdown(results)).toContain('| 94.9 |');
    expect(verdict(summarize(threeEach({ performance: 0.95 }), PAGES))).toEqual([]);
  });

  test('T7.02 report: a run with runtimeError or a null score is a failure, not a pass', () => {
    const errored = [
      lhr('/'),
      lhr('/'),
      lhr('/', {}, { runtimeError: { code: 'NO_FCP' } }),
      ...[1, 2, 3].map(() => lhr('/privacy/', { accessibility: null })),
    ];
    expect(verdict(summarize(errored, PAGES))).toEqual([
      '/: a run failed (NO_FCP)',
      '/: performance has 2 of 3 scores',
      '/: accessibility has 2 of 3 scores',
      '/: best-practices has 2 of 3 scores',
      '/: seo has 2 of 3 scores',
      '/privacy/: accessibility has 0 of 3 scores',
    ]);
  });

  test('T7.02 report: a page with no result, or fewer than 3 runs, fails', () => {
    const results = summarize([lhr('/'), lhr('/'), lhr('/')], PAGES);
    expect(verdict(results)).toContain('/privacy/: no Lighthouse result');
    expect(toMarkdown(results)).toContain(
      '| `/privacy/` | missing | missing | missing | missing |',
    );
    expect(verdict(summarize([lhr('/'), ...threeEach().slice(3)], PAGES))).toContain(
      '/: seo has 1 of 3 scores',
    );
  });

  test('T7.02 report: markdown lists all four categories for every page', () => {
    const md = toMarkdown(summarize(threeEach({ seo: 0.97 }), PAGES));
    expect(md).toContain('| page | performance | accessibility | best-practices | seo |');
    expect(md).toContain('| `/` | 100 | 100 | 100 | 97 |');
    expect(md).toContain('| `/privacy/` | 100 | 100 | 100 | 97 |');
    expect(md).toContain('**Pass.**');
    expect(md).not.toContain(FONTS_WARNING);
  });

  test('T7.02 report: a failed font request warns that scores reflect fallback fonts', () => {
    const failed = [
      { url: `${ORIGIN}/`, statusCode: 200, resourceType: 'Document' },
      { url: FONT_A, statusCode: 200, resourceType: 'Font' },
      { url: FONT_FILE, statusCode: -1, resourceType: 'Font' },
    ];
    const lhrs = [lhr('/', {}, {}, failed), lhr('/'), lhr('/'), ...threeEach().slice(3)];
    const results = summarize(lhrs, PAGES);
    expect(results[0]?.fontProblems).toEqual([`${FONT_FILE} → failed`]);
    expect(results[1]?.fontProblems).toEqual([]);
    const md = toMarkdown(results);
    expect(md).toContain(`**Warning: ${FONTS_WARNING}.**`);
    expect(md).toContain(`- /: ${FONT_FILE} → failed`);
    expect(md).toContain('**Pass (fallback fonts).**');
    expect(md).not.toContain('**Pass.**');
  });

  test('T7.02 report: a font 404 or no font request at all also warns', () => {
    const notFound = [{ url: FONT_A, statusCode: 404, resourceType: 'Font' }];
    // A font URL fetched as something other than a font (e.g. a preload that never became a face) isn't one.
    const none = [
      { url: `${ORIGIN}/privacy/`, statusCode: 200, resourceType: 'Document' },
      { url: FONT_FILE, statusCode: 200, resourceType: 'Other' },
    ];
    const lhrs = [
      ...[1, 2, 3].map(() => lhr('/', {}, {}, notFound)),
      ...[1, 2, 3].map(() => lhr('/privacy/', {}, {}, none)),
    ];
    const [home, privacy] = summarize(lhrs, PAGES);
    expect(home?.fontProblems).toEqual([`${FONT_A} → 404`]);
    expect(privacy?.fontProblems).toEqual(['no web font request was made']);
  });
});
