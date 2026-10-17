import { runCritique } from '@specimen/ai';
import { createMockProvider } from '@specimen/ai/testing';
import type { DesignScan } from '@specimen/core/schema';
import { describe, expect, it } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';

// SPC-31: the council's turns and verdict go through the brand sanitizer, which folds ß, İ,
// accents and compatibility forms.

const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/ẞ/g, 'SS')
    .replace(/ı/g, 'i')
    .toLowerCase();

const scan: DesignScan = {
  ...sampleScan,
  host: 'zentrix.io',
  url: 'https://zentrix.io/',
  title: 'Zéntrix | Straße | İzmirco',
};

const SUMMARY =
  'Verdict: The ZÉNTRIX look is calm.\nWorks:\n- Straße accent #0d9488 on white\nChange:\n- Raise Izmirco muted text to 4.5:1\nDisagreed:\n- None for Ｚｅｎｔｒｉｘ';

describe('council output folds brands (SPC-31)', () => {
  it('T3.22 no brand spelled with ß, İ, accents or fullwidth letters survives in any turn or the verdict', async () => {
    const p = createMockProvider({
      chunkSize: 3,
      respond: (req) =>
        String(req.messages[0]?.content).includes('Verdict:')
          ? SUMMARY
          : 'Zentrix uses 16px; STRASSE feels warm; ızmirco and ZéntrixBlue too. Café stays.',
    });
    const res = await runCritique(p, scan);
    expect(res.status).toBe('done');
    const texts = [
      ...res.turns.map((t) => t.content),
      res.summaryText ?? '',
      JSON.stringify(res.verdict),
    ];
    for (const t of texts) {
      for (const brand of ['zentrix', 'strasse', 'izmirco']) expect(fold(t)).not.toContain(brand);
    }
    expect(res.turns[0]?.content).toContain('16px');
    expect(res.turns[0]?.content).toContain('Café stays.');
    expect(res.verdict?.works.join(' ')).toContain('#0d9488');
  });
});
