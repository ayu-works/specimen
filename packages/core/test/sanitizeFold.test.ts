import { describe, expect, it } from 'vitest';
import { GENERATORS, PROMPT_TARGETS } from '../src/generate';
import { containsBrand, createStreamSanitizer, sanitize } from '../src/generate/sanitize';
import type { DesignScan } from '../src/schema';
import { scanOf } from './helpers';

// SPC-31: a brand spelled with ß, İ, accents or compatibility forms is matched in any spelling.

function on(host: string, title: string, patch: Partial<DesignScan> = {}): DesignScan {
  const scan = scanOf('landing-basic');
  for (const s of scan.typography.styles) delete s.sample;
  return { ...scan, host, url: `https://${host}/`, title, ...patch };
}

/** An independent fold, to check outputs with: NFKD, no marks, ß/ı folded, lower case. */
const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/ẞ/g, 'SS')
    .replace(/ı/g, 'i')
    .toLowerCase();

describe('ethics guardrail: Unicode folding (SPC-31)', () => {
  it('T2.03 an accented brand is removed in any spelling, both directions', () => {
    const accented = on('example.org', 'Zéntrix');
    for (const t of ['Zentrix', 'ZENTRIX', 'zéntrix', 'Zéntrix', 'ZÉNTRIX', 'Zéntrix']) {
      expect(sanitize(`use ${t} here`, accented), t).toBe('use here');
    }
    expect(sanitize('use ZÉNTRIXBlue and zéntrix500', accented)).toBe('use Blue and 500');
    const plain = on('zentrix.com', 'Untitled');
    for (const t of ['Zéntrix', 'ZÉNTRIX', 'Zéntrix', 'zëntrïx']) {
      expect(sanitize(`use ${t} here`, plain), t).toBe('use here');
    }
  });

  it('T2.03 ß and ẞ fold to ss, both directions', () => {
    const sharp = on('example.org', 'Straße');
    for (const t of ['STRASSE', 'Strasse', 'straße', 'STRAẞE']) {
      expect(sanitize(`the ${t} look`, sharp), t).toBe('the look');
    }
    const caps = on('example.org', 'STRASSE');
    expect(sanitize('the Straße look', caps)).toBe('the look');
  });

  it('T2.03 dotted İ and dotless ı fold to i', () => {
    const scan = on('example.org', 'İzmirco');
    for (const t of ['Izmirco', 'izmirco', 'İZMİRCO', 'ızmirco', 'i̇zmirco']) {
      expect(sanitize(`by ${t} today`, scan), t).toBe('by today');
    }
  });

  it('T2.03 compatibility forms fold: fullwidth letters and ligatures', () => {
    expect(sanitize('by Ｚｅｎｔｒｉｘ today', on('zentrix.com', 'Untitled'))).toBe('by today');
    expect(sanitize('by ﬁntrix today', on('example.org', 'Fintrix'))).toBe('by today');
    expect(sanitize('by Fintrix today', on('example.org', 'ﬁntrix'))).toBe('by today');
  });

  it('T2.03 removal takes exactly the original characters', () => {
    const scan = on('zentrix.com', 'Untitled');
    expect(sanitize('Café Zéntrix-blue look', scan)).toBe('Café -blue look');
    // A decomposed accent goes with its letter: no orphan combining mark.
    expect(sanitize('Café Zéntrix́ look', scan)).toBe('Café look');
    // Surrogate pairs next to a brand stay whole.
    expect(sanitize('👋Zéntrix👋', scan)).toBe('👋👋');
    expect(sanitize('naïve façade, Zürich, 東京', scan)).toBe('naïve façade, Zürich, 東京');
    // A match edge inside a multi-character fold (ß → ss) removes that whole character.
    expect(sanitize('Straßab.com', on('sab.com', 'Untitled'))).toBe('Stra');
  });

  it('T2.03 a host cut never leaves a brand made of its neighbours, on both paths', () => {
    const scan = on('zentrix.com', 'Untitled');
    for (const t of ['Zenzentrix.comtrix', 'Zénzentrix.comtrix', 'ZEN zentrix.com TRIX']) {
      expect(fold(sanitize(t, scan)), t).not.toContain('zentrix');
    }
  });

  // Pre-existing on the ASCII path too (one pass per pattern); follow-up SPC-49:
  // the cut of `ZENTRIX` joins `Zen` + `trix`. Flips to a failure, so drop `.fails`, once fixed.
  it.fails('T2.03 a token cut can join its neighbours into the brand (known gap, both paths)', () => {
    const scan = on('zentrix.com', 'Untitled');
    for (const t of ['ZenZENTRIXtrix', 'ZénZÉNTRIXtrix']) {
      expect(fold(sanitize(t, scan)), t).not.toContain('zentrix');
    }
  });

  it('T2.03 folding never over-redacts real values (lens B B1 on the fold path)', () => {
    // Each text has a non-ASCII character, so it takes the fold path.
    expect(sanitize('primary #cafe00 and #CAFE12 — é', on('example.org', 'Café'))).toBe(
      'primary #cafe00 and #CAFE12 — é',
    );
    expect(sanitize('box-shadow: 0 1px; .boxed — é', on('example.org', 'Böx'))).toBe(
      'box-shadow: 0 1px; .boxed — é',
    );
    expect(sanitize('max-width: 100vw — é', on('vw.com', 'Untitled'))).toBe('max-width: 100vw — é');
    expect(sanitize('transition 150ms — é', on('ms.com', 'Untitled'))).toBe('transition 150ms — é');
    expect(sanitize('ring #0cafe0 — é', on('café.com', 'Untitled'))).toBe('ring #0cafe0 — é');
    const prose = 'Café au lait, Straße, İstanbul, naïve: 16px';
    expect(sanitize(prose, on('zentrix.com', 'Zéntrix'))).toBe(prose);
  });

  it('T2.03 an IDN site (punycode host) still loses its Unicode title through the phrase path', () => {
    const scan = on('xn--zntrix-dva.de', 'Zéntrix Gärten');
    expect(sanitize('by Zentrix Garten and ZÉNTRIX GÄRTEN today', scan)).toBe('by and today');
    expect(sanitize('see xn--zntrix-dva.de now', scan)).toBe('see now');
  });

  it('T2.03 CSS variable names: containsBrand folds the name', () => {
    expect(containsBrand('--zéntrixBlue', ['zentrix'])).toBe(true);
    expect(containsBrand('--ZÉNTRIX_RED', ['zentrix'])).toBe(true);
    expect(containsBrand('--straßeGray', ['strasse'])).toBe(true);
    expect(containsBrand('--café-brown', ['zentrix'])).toBe(false);
  });

  it('T2.03 every generator drops a brand spelled with ß, İ or accents', () => {
    const scan = on('zentrix.com', 'Zéntrix Straße | İzmirco', {
      cssVariables: {
        '--zéntrixBlue': '#123456',
        '--ZENTRİX_RED': '#123457',
        '--straßeGray': '#123458',
        '--izmircoTeal': '#123459',
        '--space-4': '16px',
      },
    });
    for (const g of GENERATORS) {
      for (const target of g.id === 'prompt' ? PROMPT_TARGETS : [undefined]) {
        const out = fold(g.run(scan, { target }).content);
        for (const brand of ['zentrix', 'strasse', 'izmirco']) {
          expect(out, `${g.id}/${target ?? ''}: ${brand}`).not.toContain(brand);
        }
      }
    }
  });

  it('T2.03 the stream sanitizer folds too and ends equal to a full sanitize', () => {
    const scan = on('example.org', 'Zéntrix');
    const text =
      'Zentrix is calm.\nThe ZÉNTRIX accent, zéntrix500 and Ｚｅｎｔｒｉｘ.\nCafé stays.';
    const next = createStreamSanitizer(scan);
    let snap = '';
    for (let i = 1; i <= text.length; i++) {
      snap = next(text.slice(0, i));
      expect(fold(snap)).not.toContain('zentrix');
    }
    expect(snap).toBe(sanitize(text, scan));
    expect(snap).toContain('Café stays.');
  });

  it('T2.03 ASCII text takes the fast path and is unchanged by folding', () => {
    const scan = on('zentrix.com', 'Zéntrix');
    expect(sanitize('use zentrixBlue, myZentrix and ZENTRIX500 here', scan)).toBe(
      'use Blue, my and 500 here',
    );
  });

  it('T2.03 a 10 KB accented line with a 30k-char accented title is fast', () => {
    let title = '';
    for (let i = 0; title.length < 30_000; i++) title += `qé${i.toString(36)}ßvél `;
    const scan = on('example.org', title);
    const line = 'Ünïcödé façade Straße İzmir 東京 👋 '.repeat(300).slice(0, 10_000);
    sanitize('warm-up', on('example.org', 'Warm')); // first-use cost of the regex engine
    const t0 = performance.now();
    sanitize(line, scan);
    // Same CI budget as the ASCII case in sanitizeLimits.test.ts (3× the SPC-32 pass bar).
    expect(performance.now() - t0).toBeLessThan(150);
  });
});
