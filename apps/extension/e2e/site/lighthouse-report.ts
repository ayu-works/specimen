// T7.02: pure report logic for the Lighthouse run in lighthouse.ts. No I/O, so the tests stay offline.
// Pass bar: for every page, the median of RUNS runs is a raw score >= 0.95 in each category (no rounding:
// 0.949 fails). An errored run or a null score counts against the page; it is never dropped silently.

export const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
export type Category = (typeof CATEGORIES)[number];
export const RUNS = 3;
export const BAR = 0.95;

/** The parts of a Lighthouse result (LHR) the report reads. */
export interface Lhr {
  requestedUrl?: string;
  finalUrl?: string;
  finalDisplayedUrl?: string;
  runtimeError?: { code: string; message?: string };
  categories: Partial<Record<string, { score: number | null }>>;
  audits?: Partial<
    Record<
      string,
      { details?: { items?: Array<{ url?: string; statusCode?: number; resourceType?: string }> } }
    >
  >;
}

export interface CategoryResult {
  category: Category;
  /** Median of the usable runs, or null when fewer than RUNS runs produced a score. */
  median: number | null;
  scores: number[];
}

export interface PageResult {
  page: string;
  runs: number;
  errors: string[];
  categories: CategoryResult[];
  /** Web font requests that failed or returned non-200 (or none at all), across all runs. */
  fontProblems: string[];
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function pageOf(lhr: Lhr): string {
  const url = lhr.requestedUrl ?? lhr.finalDisplayedUrl ?? lhr.finalUrl ?? '?';
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function fontProblemsOf(lhr: Lhr): string[] {
  const items = lhr.audits?.['network-requests']?.details?.items;
  if (!items) return ['no network-requests audit in the result'];
  const fonts = items.filter((r) => r.resourceType === 'Font');
  if (fonts.length === 0) return ['no web font request was made'];
  // Lighthouse reports a failed request (DNS, offline, blocked) with statusCode -1.
  return fonts
    .filter((r) => r.statusCode !== 200)
    .map((r) => `${r.url} → ${r.statusCode === -1 ? 'failed' : (r.statusCode ?? 'no status')}`);
}

/** Groups LHRs by page (in `pages` order) and takes the median of each category. */
export function summarize(lhrs: Lhr[], pages: string[]): PageResult[] {
  return pages.map((page) => {
    const mine = lhrs.filter((l) => pageOf(l) === page);
    const errors = mine.filter((l) => l.runtimeError).map((l) => l.runtimeError?.code ?? 'error');
    const usable = mine.filter((l) => !l.runtimeError);
    const categories = CATEGORIES.map((category) => {
      const scores = usable
        .map((l) => l.categories[category]?.score)
        .filter((s): s is number => typeof s === 'number');
      return { category, scores, median: scores.length >= RUNS ? median(scores) : null };
    });
    const fontProblems = [...new Set(usable.flatMap(fontProblemsOf))];
    return { page, runs: mine.length, errors, categories, fontProblems };
  });
}

/** Problems against the pass bar; empty means pass. */
export function verdict(results: PageResult[], bar = BAR): string[] {
  const problems: string[] = [];
  for (const r of results) {
    if (r.runs === 0) problems.push(`${r.page}: no Lighthouse result`);
    for (const e of r.errors) problems.push(`${r.page}: a run failed (${e})`);
    for (const c of r.categories) {
      if (c.median === null) {
        problems.push(`${r.page}: ${c.category} has ${c.scores.length} of ${RUNS} scores`);
      } else if (!(c.median >= bar)) {
        problems.push(`${r.page}: ${c.category} ${c.median.toFixed(3)} < ${bar}`);
      }
    }
  }
  return problems;
}

export const FONTS_WARNING = 'fonts did not load: scores reflect fallback fonts';

// One decimal, not rounded to an integer, so a failing 0.949 never displays as a passing "95".
const show = (m: number | null) => (m === null ? 'missing' : String(Number((m * 100).toFixed(1))));

export function toMarkdown(results: PageResult[], bar = BAR): string {
  const problems = verdict(results, bar);
  const lines = [
    `### T7.02 Lighthouse (median of ${RUNS} runs, bar: every score ≥ ${bar * 100})`,
    '',
    `| page | ${CATEGORIES.join(' | ')} |`,
    `|---|${CATEGORIES.map(() => '---:').join('|')}|`,
    ...results.map(
      (r) => `| \`${r.page}\` | ${r.categories.map((c) => show(c.median)).join(' | ')} |`,
    ),
    '',
    problems.length === 0
      ? '**Pass.**'
      : `**Below the bar:**\n${problems.map((p) => `- ${p}`).join('\n')}`,
  ];
  const fonts = results.flatMap((r) => r.fontProblems.map((p) => `${r.page}: ${p}`));
  if (fonts.length) lines.push('', `**Warning: ${FONTS_WARNING}.**`, ...fonts.map((f) => `- ${f}`));
  return `${lines.join('\n')}\n`;
}
