import { describe, expect, it } from 'vitest';
import { generateDesignMd, generatePrompt } from '../src/generate';
import { fontInfo } from '../src/generate/fonts';
import { containsBrand, sanitize } from '../src/generate/sanitize';
import type { DesignScan } from '../src/schema';
import { scanOf } from './helpers';

const TARGETS = [undefined, 'claude-code', 'cursor', 'v0', 'lovable'] as const;

/** A fixture scan moved to another host/title, so its brand tokens are known. */
function on(host: string, title = 'Untitled', patch: Partial<DesignScan> = {}): DesignScan {
  const scan = scanOf('landing-basic');
  // Headline samples are removed by sanitize as phrases; drop them so only host/title tokens act.
  for (const s of scan.typography.styles) delete s.sample;
  return { ...scan, host, url: `https://${host}/`, title, ...patch };
}

/** Every generated text a user can copy for this scan. */
function outputs(scan: DesignScan): [string, string][] {
  return [
    ...TARGETS.map((t): [string, string] => [
      `prompt/${t ?? 'generic'}`,
      generatePrompt(scan, { target: t }).content,
    ]),
    ['DESIGN.md', generateDesignMd(scan).content],
  ];
}

describe('ethics guardrail: brand names in identifiers (audit H3, M15, M16)', () => {
  it('T2.03 DESIGN.md drops a brand inside camelCase, all-lowercase, upper-snake and digit-suffixed CSS variables', () => {
    const scan = on('zentrix.com', 'Untitled', {
      cssVariables: {
        '--zentrixBlue': '#123456',
        '--brandZentrix': '#123457',
        '--zentrixblue': '#123458',
        '--ZENTRIX_RED': '#123459',
        '--zentrix500': '#12345a',
        '--ZENTRIXBlue': '#12345b',
        '--accent-ref': 'var(--zentrixBlue)',
        '--space-4': '16px',
      },
    });
    const md = generateDesignMd(scan).content;
    expect(md.toLowerCase()).not.toContain('zentrix');
    expect(md).toContain('`--space-4`');
  });

  it('T2.03 a 2–3 letter brand only matches at word or case boundaries in CSS variable names', () => {
    const md = generateDesignMd(
      on('hp.com', 'Untitled', {
        cssVariables: { '--php-version': '8', '--hpBlue': '#123456', '--space-4': '16px' },
      }),
    ).content;
    expect(md).toContain('`--php-version`');
    expect(md).not.toMatch(/hpBlue/i);
  });

  it('T2.03 sanitize strips a brand at case and digit humps but leaves ordinary words alone', () => {
    const scan = on('zentrix.com');
    const strip = (s: string) => sanitize(s, scan);
    expect(strip('use zentrixBlue here')).toBe('use Blue here');
    expect(strip('use myZentrix here')).toBe('use my here');
    expect(strip('use ZENTRIXBlue here')).toBe('use Blue here');
    expect(strip('use zentrix500 here')).toBe('use 500 here');
    expect(strip('Zentrix, zentrix and ZENTRIX')).not.toMatch(/zentrix/i);
    expect(strip('zentrixes and prezentrix stay')).toBe('zentrixes and prezentrix stay');

    const cal = on('cal.com');
    expect(sanitize('Calendar app and iCal feed', cal)).toBe('Calendar app and i feed');
    expect(sanitize('background: linear-gradient(red, blue)', on('linear.app'))).toContain(
      'linear-gradient',
    );
    expect(containsBrand('--zentrixBlue', ['zentrix'])).toBe(true);
    expect(containsBrand('Calendar', ['cal'])).toBe(false);
  });

  it('T2.03 short brands never eat hex colors or CSS units (lens B B1)', () => {
    const keep: [string, string][] = [
      ['abc.xyz', 'The accent #1abc9c'],
      ['ea.com', 'link #1ea0ff'],
      ['bbc.co.uk', 'border #2bbc4f'],
      ['ab.com', 'fill #ab12ab'],
      ['ab.com', 'stroke #abcdef on the tab bar, #ABCDEF too'],
      ['cafe.com', 'ring #0cafe0 and #CAFE00'],
      ['vw.com', 'max-width: 100vw'],
      ['ms.com', 'transition 150ms ease'],
    ];
    for (const [host, text] of keep) expect(sanitize(text, on(host)), host).toBe(text);
    for (const [host, hex] of [
      ['abc.xyz', '#1abc9c'],
      ['cafe.com', '#0cafe0'],
    ] as const) {
      const scan = on(host);
      const accent = scan.colors.palette.find((t) => t.id === scan.colors.roles.accent);
      if (!accent) throw new Error('fixture has no accent');
      accent.hex = hex;
      for (const [where, out] of outputs(scan)) expect(out, `${host} ${where}`).toContain(hex);
    }
    // A brand that is not a hex word is still stripped after a '#', and long tokens keep digit humps.
    const z = on('zentrix.com');
    expect(sanitize('see #zentrix-docs', z)).not.toMatch(/zentrix/i);
    expect(sanitize('zentrix500 and 2zentrix', z)).toBe('500 and 2');
  });

  it('T2.03 DESIGN.md drops CSS variables whose value aliases a branded variable (lens B B2)', () => {
    const md = generateDesignMd(
      on('zentrix.com', 'Untitled', {
        cssVariables: {
          '--color-primary': 'var(--zentrixblue)',
          '--accent': 'var(--UIZentrixBlue)',
          '--x': 'var(--ZXZentrix-500)',
          '--space-4': '16px',
        },
      }),
    ).content;
    expect(md.toLowerCase()).not.toContain('zentrix');
    expect(md).toContain('`--space-4`');
    expect(sanitize('XMLZentrix ZENTRIXapi', on('zentrix.com'))).not.toMatch(/zentrix/i);
  });

  it('T2.03 host forms and a title-only brand never reach any prompt or DESIGN.md', () => {
    const cases: [string, string][] = [
      ['app.zentrix.io', 'Untitled'],
      ['WWW.ZENTRIX.COM', 'Untitled'],
      ['shop.zentrix.co.uk', 'Untitled'],
      ['zentrix.dev:8080', 'Untitled'],
      ['example.org', 'Zentrix | Payments for teams'],
    ];
    for (const [host, title] of cases) {
      const scan = on(host, title, {
        cssVariables: { '--zentrixBlue': '#123456', '--space-4': '16px' },
      });
      scan.typography.families[0] = {
        ...(scan.typography.families[0] as DesignScan['typography']['families'][number]),
        name: 'Zentrix Sans',
        stack: '"Zentrix Sans", system-ui, sans-serif',
      };
      for (const [where, text] of outputs(scan)) {
        // A plain substring search, so the check can't share a boundary bug with the code.
        expect(text.toLowerCase(), `${host} ${where}`).not.toContain('zentrix');
      }
    }
  });

  it('T2.03 a branded font family gets the placeholder label and an alternative (not just sanitize)', () => {
    const scan = on('zentrix.com');
    const family = {
      ...(scan.typography.families[0] as DesignScan['typography']['families'][number]),
      role: 'display' as const,
      name: 'Zentrix Grotesk',
      stack: '"Zentrix Grotesk", Helvetica, sans-serif',
      source: 'self-hosted' as const,
    };
    const info = fontInfo(scan, family);
    expect(info.branded).toBe(true);
    expect(info.label).toBe("the source's custom display face");
    expect(info.alternative).toBeTruthy();
    expect(info.stack.toLowerCase()).not.toContain('zentrix');

    // Run together, with no hump or separator (lens B B4).
    const joined = { ...family, name: 'zentrixsans', stack: 'zentrixsans, sans-serif' };
    expect(fontInfo(scan, joined).branded).toBe(true);
    scan.typography.families[0] = joined;
    for (const [where, out] of outputs(scan))
      expect(out.toLowerCase(), where).not.toContain('zentrix');
  });
});
