// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { skipReasonOf } from '../src/lib/messaging';
import { collectCssom } from '../src/sampler/cssom';

const parse = vi.hoisted(() => ({ throwOn: null as string | null }));
vi.mock('@specimen/core/cssText', async (orig) => {
  const real = await orig<typeof import('@specimen/core/cssText')>();
  return {
    ...real,
    parseCssText: (text: string) => {
      if (parse.throwOn && text.includes(parse.throwOn)) throw new RangeError('boom');
      return real.parseCssText(text);
    },
  };
});

/** Pretend the page links these cross-origin sheets, whose rules the CSSOM refuses to expose. */
function linkBlocked(hrefs: string[]) {
  const sheets = hrefs.map((href) => ({
    href,
    get cssRules(): CSSRuleList {
      throw new DOMException('Cannot access rules', 'SecurityError');
    },
  }));
  Object.defineProperty(document, 'styleSheets', { configurable: true, get: () => sheets });
}

beforeEach(() => {
  parse.throwOn = null;
});

afterEach(() => {
  Reflect.deleteProperty(document, 'styleSheets');
});

describe('cross-origin stylesheet warnings in the sampler (audit H11)', () => {
  it('T1.12 each skip reason gives its own warning; a bare null keeps the old text', async () => {
    linkBlocked([
      'https://a.test/x.css',
      'https://b.test/x.css',
      'https://c.test/x.css',
      'https://d.test/x.css',
    ]);
    const css = await collectCssom(async () => [
      { skipped: 'no site access' },
      { skipped: 'HTTP 404' },
      { skipped: 'network error' },
      null,
    ]);
    expect(css.warnings).toEqual([
      'cross-origin stylesheet skipped: a.test (no site access)',
      'cross-origin stylesheet skipped: b.test (HTTP 404)',
      'cross-origin stylesheet skipped: c.test (network error)',
      'cross-origin stylesheet skipped: d.test',
    ]);
  });

  it('T1.12 a reason outside the fixed set is not echoed into the warning', async () => {
    linkBlocked(['https://a.test/x.css']);
    const css = await collectCssom(async () => [{ skipped: '<script>alert(1)</script>' }] as never);
    expect(css.warnings).toEqual(['cross-origin stylesheet skipped: a.test']);
  });

  it('T1.12 a fetcher that throws: every sheet is skipped as "fetch failed", the scan goes on', async () => {
    linkBlocked(['https://a.test/x.css']);
    const css = await collectCssom(async () => {
      throw new Error('Receiving end does not exist.');
    });
    expect(css.warnings).toEqual(['cross-origin stylesheet skipped: a.test (fetch failed)']);
  });

  it('T1.12 20k-nested @media text: no crash, and the rules around it are read', async () => {
    linkBlocked(['https://a.test/deep.css']);
    const deep = `:root{--x-before:1}${'@media a{'.repeat(20_000)}${'}'.repeat(20_000)}:root{--x-after:1}`;
    const css = await collectCssom(async () => [deep]);
    expect(css.warnings).toEqual([]);
    expect(css.mediaQueries.length).toBeGreaterThan(0);
  });

  it('T1.12 a sheet whose parse throws is dropped with a warning; the next sheet is still read', async () => {
    linkBlocked(['https://a.test/bad.css', 'https://b.test/good.css']);
    parse.throwOn = 'HOSTILE';
    const css = await collectCssom(async () => ['/* HOSTILE */', '@media (min-width: 9px){}']);
    expect(css.warnings).toEqual(['cross-origin stylesheet unreadable: a.test']);
    expect(css.mediaQueries).toContain('(min-width: 9px)');
  });

  it('T1.12 sheets past the 24 cap are warned about, not silently dropped', async () => {
    const hrefs = Array.from({ length: 26 }, (_, i) => `https://h${i}.test/x.css`);
    linkBlocked(hrefs);
    const fetchCss = vi.fn(async (urls: string[]) => urls.map(() => ''));
    const css = await collectCssom(fetchCss);
    expect(fetchCss.mock.calls[0]?.[0]).toHaveLength(24);
    expect(css.warnings).toEqual([
      'cross-origin stylesheet skipped: h24.test (over the 24-stylesheet limit)',
      'cross-origin stylesheet skipped: h25.test (over the 24-stylesheet limit)',
    ]);
  });
});

describe('skipReasonOf', () => {
  it.each([
    [{ skipped: 'no site access' }, 'no site access'],
    [{ skipped: 'HTTP 503' }, 'HTTP 503'],
    [{ skipped: 'HTTP 404 Not Found' }, null],
    [{ skipped: 'HTTP 99' }, null],
    [{ skipped: 42 }, null],
    [null, null],
    ['text', null],
  ])('T1.12 %j → %s', (entry, want) => {
    expect(skipReasonOf(entry)).toBe(want);
  });
});
