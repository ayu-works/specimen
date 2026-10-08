import { describe, expect, it } from 'vitest';
import { parseCssText, parseDeclarations, stripComments } from './cssText';

describe('cssText', () => {
  it('strips comments but keeps string contents', () => {
    expect(stripComments('a/*x*/b "/* keep */" c')).toBe('ab "/* keep */" c');
  });

  it('collects custom properties from :root, html and body only', () => {
    const r = parseCssText(`
      :root { --brand: #5e6ad2; --font: "Inter", sans-serif; color: red }
      html.dark, body { --bg: #000 }
      .card { --local: 1px }
      :root:not(.x) { --c: calc(1px + (2px * 3)) }
    `);
    expect(r.vars).toEqual({
      '--brand': '#5e6ad2',
      '--font': '"Inter", sans-serif',
      '--bg': '#000',
      '--c': 'calc(1px + (2px * 3))',
    });
  });

  it('collects @media conditions including nested and @supports-wrapped', () => {
    const r = parseCssText(`
      @media (min-width: 640px) { .a { x: y } @media (min-width: 1024px) { .b { x: y } } }
      @supports (display: grid) { @media screen and (max-width:  500px) { :root { --m: 1 } } }
      @media print { .c { x: y } }
    `);
    expect(r.mediaQueries).toEqual([
      '(min-width: 640px)',
      '(min-width: 1024px)',
      'screen and (max-width: 500px)',
      'print',
    ]);
    expect(r.vars['--m']).toBe('1');
  });

  it('parses @font-face with urls containing semicolons and commas', () => {
    const r = parseCssText(`
      @font-face { font-family: 'Inter Var'; src: url(data:font/woff2;base64,AAA=) format("woff2"), url("/f.woff") format('woff');
        font-weight: 100 900; font-style: normal; }
      @font-face { src: url(x.woff) }
    `);
    expect(r.fontFaces).toEqual([
      {
        family: 'Inter Var',
        src: 'url(data:font/woff2;base64,AAA=) format("woff2"), url("/f.woff") format(\'woff\')',
        weight: '100 900',
        style: 'normal',
      },
    ]);
  });

  it('records @import targets', () => {
    const r = parseCssText(
      `@charset "utf-8"; @import url("a.css") screen; @import 'b.css'; @import url(c.css); :root{--x:1}`,
    );
    expect(r.imports).toEqual(['a.css', 'b.css', 'c.css']);
    expect(r.vars['--x']).toBe('1');
  });

  it('ignores keyframes and survives braces inside strings and malformed input', () => {
    const r = parseCssText(`
      @keyframes spin { from { --nope: 1 } to { --nope: 2 } }
      .x::after { content: "}{" }
      :root { --ok: "a;b" }
      @media (min-width: 1px) { :root { --unclosed: 1
    `);
    expect(r.vars['--ok']).toBe('"a;b"');
    expect(r.vars['--nope']).toBeUndefined();
    expect(r.mediaQueries).toEqual(['(min-width: 1px)']);
  });

  it('strips !important and splits declarations on top-level semicolons', () => {
    expect(parseDeclarations('--a: 1 !important; --b: url(x;y); color: red')).toEqual([
      ['--a', '1'],
      ['--b', 'url(x;y)'],
      ['color', 'red'],
    ]);
  });

  it('handles empty input', () => {
    expect(parseCssText('')).toEqual({ vars: {}, mediaQueries: [], fontFaces: [], imports: [] });
  });
});
