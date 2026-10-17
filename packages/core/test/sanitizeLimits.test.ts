import { describe, expect, it } from 'vitest';
import { generateDesignMd, generatePrompt, PROMPT_TARGETS } from '../src/generate';
import { fontInfo } from '../src/generate/fonts';
import {
  brandTokens,
  containsBrand,
  createStreamSanitizer,
  MAX_TITLE_TOKENS,
  MAX_TOKEN,
  sanitize,
  TITLE_SCAN,
} from '../src/generate/sanitize';
import type { DesignScan } from '../src/schema';
import { scanOf } from './helpers';

// CI-safe budgets: 3× the pass bar in docs/sprint/handoffs/SPC-32.md (100 / 50 / 300 ms).
const BUDGET = { designMd: 300, sanitize: 150, stream: 900 };

/** A run-unique word list, so every timed call is a cache miss (the cost of first opening a scan). */
let run = 0;
function words(n: number): string[] {
  run++;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`q${run.toString(36)}x${i.toString(36)}vel`);
  return out;
}
const titleOf = (chars: number) => {
  let t = '';
  for (const w of words(Math.ceil(chars / 4))) {
    if (t.length >= chars) break;
    t += `${w} `;
  }
  return t.slice(0, chars);
};

function on(host: string, title: string, patch: Partial<DesignScan> = {}): DesignScan {
  const scan = scanOf('landing-basic');
  for (const s of scan.typography.styles) delete s.sample;
  return { ...scan, host, url: `https://${host}/`, title, ...patch };
}

function vars(n: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++) out[`--space-${i}`] = `${i * 4}px`;
  return out;
}

function timed(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

describe('ethics guardrail: hostile page titles (SPC-17 sec H1, M1)', () => {
  it('T2.03 DESIGN.md with a 30k-char title of distinct words and 200 variables is fast, and no brand leaks', () => {
    generateDesignMd(on('zentrix.com', titleOf(30_000), { cssVariables: vars(200) })); // warm-up
    const runs: number[] = [];
    let md = '';
    let scan: DesignScan | undefined;
    for (let i = 0; i < 3; i++) {
      scan = on('zentrix.com', titleOf(30_000), {
        cssVariables: { ...vars(200), '--zentrixBlue': '#123456' },
      });
      const s = scan;
      runs.push(timed(() => (md = generateDesignMd(s).content)));
    }
    expect(median(runs)).toBeLessThan(BUDGET.designMd);
    if (!scan) throw new Error('no scan');
    const lower = md.toLowerCase();
    expect(lower).not.toContain('zentrix');
    for (const t of brandTokens(scan)) expect(lower, t).not.toContain(t);
    expect(md).toContain('`--space-4`');
  });

  it('T2.03 sanitize of a 10 KB text with a 30k-char title is fast (cache miss each run)', () => {
    const body = 'The accent is #0d9488 at 16px on zentrix. '.repeat(250);
    const runs: number[] = [];
    let out = '';
    for (let i = 0; i < 3; i++) {
      const scan = on('zentrix.com', titleOf(30_000));
      runs.push(timed(() => (out = sanitize(body, scan))));
    }
    expect(median(runs)).toBeLessThan(BUDGET.sanitize);
    expect(out.toLowerCase()).not.toContain('zentrix');
    expect(out).toContain('#0d9488 at 16px');
  });

  it('T2.03 a 40k-char title or a 40k-char single word never makes a generator throw', () => {
    for (const title of [titleOf(40_000), 'z'.repeat(40_000), `Zentrix ${'a'.repeat(40_000)}`]) {
      const scan = on('zentrix.com', title);
      const font = scan.typography.families[0];
      if (!font) throw new Error('fixture has no font family');
      expect(() => sanitize('zentrix at 16px', scan)).not.toThrow();
      expect(sanitize('zentrix at 16px', scan).trim()).toBe('at 16px');
      expect(() => generateDesignMd(scan)).not.toThrow();
      expect(() => fontInfo(scan, font)).not.toThrow();
      for (const target of PROMPT_TARGETS) {
        expect(generatePrompt(scan, { target }).content.toLowerCase()).not.toContain('zentrix');
      }
    }
  });

  it('T2.03 the caps keep the brand: the domain always, and the first title words', () => {
    const scan = on('example.org', `Zentrix | ${titleOf(30_000)}`);
    const tokens = brandTokens(scan);
    expect(tokens).toContain('zentrix');
    expect(tokens).toContain('example');
    expect(tokens.length).toBeLessThanOrEqual(MAX_TITLE_TOKENS + 1);
    expect(sanitize('Zentrix and example', scan).trim()).toBe('and');
    // A long title can't push the domain out, and no token is longer than a DNS label.
    const long = on('zentrix.com', `${'w'.repeat(MAX_TOKEN + 1)} ${titleOf(30_000)}`);
    expect(brandTokens(long)).toContain('zentrix');
    for (const t of brandTokens(long)) expect(t.length).toBeLessThanOrEqual(MAX_TOKEN);
    // A word cut by the scan window is not a token (it would be a fragment).
    const cut = on('example.org', `${'a '.repeat(TITLE_SCAN / 2 - 2)}xyzzyplugh`);
    expect(brandTokens(cut)).not.toContain('xyzz');
  });

  it('T2.03 cached patterns stay per brand set and keep no state between calls', () => {
    const a = on('zentrix.com', 'Quorvane');
    const b = on('example.org', 'Plinthor');
    const strip = (scan: DesignScan) => sanitize('Quorvane Plinthor', scan).trim();
    expect(strip(a)).toBe('Plinthor');
    expect(strip(b)).toBe('Quorvane');
    expect(strip(a)).toBe('Plinthor');
    // Same object, edited title: the cache is keyed by content, not identity.
    a.title = 'Plinthor';
    expect(strip(a)).toBe('Quorvane');
    for (let i = 0; i < 3; i++) expect(containsBrand('--zentrixBlue', ['zentrix'])).toBe(true);
  });
});

describe('ethics guardrail: streamed text (SPC-17 sec H1)', () => {
  const scan = on('zentrix.com', 'Zentrix Cloud', {});

  function stream(text: string, chunk: number): { snaps: string[]; last: string } {
    const s = createStreamSanitizer(scan);
    const snaps: string[] = [];
    let raw = '';
    for (let i = 0; i < text.length; i += chunk) {
      raw += text.slice(i, i + chunk);
      snaps.push(s(raw));
    }
    return { snaps, last: snaps.at(-1) ?? '' };
  }

  it('T2.03 the stream sanitizer ends equal to a full sanitize, and every snapshot is sanitized', () => {
    // The last line of the first two is short, so their last snapshot is exact. The third is one long
    // line, re-sanitized in steps; its snapshots lag but stay sanitized (callers re-sanitize the end).
    const texts: [string, boolean][] = [
      ['Zentrix uses #1a2b3c.\nThe zentrixBlue accent\n\nat 16px, ZENTRIX api.', true],
      [`Zentrix\nCloud is ${'calm and airy, '.repeat(80)}zentrix again\nend`, true],
      [`one long line ${'zentrix at 16px and #0d9488 '.repeat(100)}`, false],
    ];
    for (const [text, exact] of texts) {
      for (const chunk of [1, 3, 7, 50]) {
        const { snaps, last } = stream(text, chunk);
        if (exact) expect(last, `chunk ${chunk}`).toBe(sanitize(text, scan));
        for (const s of snaps) expect(s.toLowerCase()).not.toMatch(/zentrix/);
      }
    }
  });

  it('T2.03 a title phrase split across a line break never shows up in a snapshot', () => {
    const { snaps, last } = stream('Brand: Zentrix\nCloud here.\nZentrix Cloud ok', 2);
    for (const s of snaps) expect(s).not.toMatch(/zentrix/i);
    expect(last).not.toMatch(/zentrix|zentrix cloud/i);
  });

  it('T2.03 a 3,000-delta reply on one 10 KB line with a 300-word title is fast', () => {
    const s = on('zentrix.com', words(300).join(' '));
    const text = 'The accent is #0d9488 at 16px on zentrix. '.repeat(240);
    const chunk = Math.ceil(text.length / 3000);
    const san = createStreamSanitizer(s);
    let raw = '';
    let last = '';
    const ms = timed(() => {
      for (let i = 0; i < text.length; i += chunk) {
        raw += text.slice(i, i + chunk);
        last = san(raw);
      }
    });
    expect(ms).toBeLessThan(BUDGET.stream);
    expect(last.toLowerCase()).not.toContain('zentrix');
    expect(last.length).toBeGreaterThan(text.length * 0.6);
  });

  it('T2.03 a stream sanitizer started over (shorter text) does not reuse old lines', () => {
    const s = createStreamSanitizer(scan);
    s('first line\nsecond');
    expect(s('new')).toBe('new');
  });
});
