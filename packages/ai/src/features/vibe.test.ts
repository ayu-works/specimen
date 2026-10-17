import { BOUNDS, type DesignScan, DesignScanSchema } from '@specimen/core/schema';
import { describe, expect, it } from 'vitest';
import { httpError, TRUNCATED_TEXT } from '../errors';
import { createMockProvider } from '../testing/mockProvider';
import { loadFixtureScan } from '../testing/testUtils';
import { ProviderError } from '../types';
import { VIBE_FILTERED, vibe } from './vibe';

const scan = loadFixtureScan('landing-basic');
const SHOT = 'data:image/jpeg;base64,QUJD';
const JSON_OUT = '{"summary":"Calm and airy.","keywords":["calm","airy"]}';

const hasImage = (c: unknown) => Array.isArray(c) && c.some((p) => p.type === 'image');

describe('vibe', () => {
  it('uses the screenshot with a vision-capable provider', async () => {
    const p = createMockProvider({ vision: true, text: JSON_OUT });
    const v = await vibe(p, scan, SHOT);
    expect(v).toMatchObject({
      summary: 'Calm and airy.',
      keywords: ['calm', 'airy'],
      usedImage: true,
      model: 'mock',
    });
    expect(hasImage(p.calls[0]?.messages[0]?.content)).toBe(true);
    expect(p.calls[0]?.json).toBe(true);
  });

  it('falls back to text-only when the provider is not vision-capable', async () => {
    const p = createMockProvider({ vision: false, text: JSON_OUT });
    const v = await vibe(p, scan, SHOT);
    expect(v.usedImage).toBe(false);
    expect(typeof p.calls[0]?.messages[0]?.content).toBe('string');
    expect(String(p.calls[0]?.messages[0]?.content)).toContain('<page_data>');
  });

  it('a reply cut off at the length limit rejects with the cut-off text and is never parsed', async () => {
    const p = createMockProvider({
      chunks: ['{"summary":"Calm and airy."', '}', ',"keywords":["calm"'],
      error: new ProviderError('other', TRUNCATED_TEXT),
      errorAfter: 3,
    });
    await expect(vibe(p, scan, null)).rejects.toMatchObject({
      kind: 'other',
      message: TRUNCATED_TEXT,
    });
    expect(p.calls).toHaveLength(1);
  });

  it('is text-only when no screenshot is given', async () => {
    const p = createMockProvider({ vision: true, text: JSON_OUT });
    expect((await vibe(p, scan, null)).usedImage).toBe(false);
  });

  it('retries text-only when a 400 says content must be a string', async () => {
    let n = 0;
    const base = createMockProvider({ vision: true, text: JSON_OUT });
    const p = {
      ...base,
      async *chat(req: Parameters<typeof base.chat>[0], signal?: AbortSignal) {
        n++;
        if (hasImage(req.messages[0]?.content)) {
          throw await httpError(
            new Response(
              JSON.stringify({ error: { message: 'messages.0.content must be a string' } }),
              { status: 400 },
            ),
          );
        }
        yield* base.chat(req, signal);
      },
    };
    const v = await vibe(p, scan, SHOT);
    expect(n).toBe(2);
    expect(v.usedImage).toBe(false);
    expect(v.summary).toBe('Calm and airy.');
  });

  it('does not retry for another 400 whose text merely mentions an image', async () => {
    let n = 0;
    const base = createMockProvider({ vision: true, text: JSON_OUT });
    const p = {
      ...base,
      // biome-ignore lint/correctness/useYield: throws before yielding on purpose
      async *chat(): AsyncGenerator<string> {
        n++;
        throw await httpError(
          new Response(JSON.stringify({ error: { message: 'Image too large: max 20MB' } }), {
            status: 400,
          }),
        );
      },
    };
    await expect(vibe(p, scan, SHOT)).rejects.toMatchObject({ kind: 'other' });
    expect(n).toBe(1);
  });

  it('does not retry unrelated errors', async () => {
    const p = createMockProvider({
      vision: true,
      error: new ProviderError('rate', 'Rate limited'),
    });
    await expect(vibe(p, scan, SHOT)).rejects.toMatchObject({ kind: 'rate' });
    expect(p.calls).toHaveLength(1);
  });

  it('survives non-JSON output by using the text as the summary', async () => {
    const p = createMockProvider({ text: 'Quiet, spacious and precise.' });
    const v = await vibe(p, scan, null);
    expect(v.summary).toBe('Quiet, spacious and precise.');
    expect(v.keywords).toEqual([]);
  });
});

// A looping model ignores maxTokens: its vibe must still fit the v5 bounds, or updateScan rejects it.
describe('vibe output fits the DesignScan v5 bounds (SPC-33)', () => {
  const branded: DesignScan = {
    ...scan,
    host: 'zentrix.io',
    url: 'https://zentrix.io/',
    title: 'Zentrix',
  };
  const reply = (summary: string, keywords: string[]) => JSON.stringify({ summary, keywords });
  const fitsSchema = (v: { summary: string; keywords: string[]; model: string }) =>
    DesignScanSchema.safeParse({
      ...scan,
      vibe: { summary: v.summary, keywords: v.keywords, model: v.model },
    }).success;

  it('T3.35 a looping JSON reply is clamped: summary, keyword count and keyword length', async () => {
    const summary = 'calm airy spacious '.repeat(3000);
    const keywords = Array.from({ length: 10_000 }, (_, i) => `k${i} ${'wide '.repeat(100)}`);
    const p = createMockProvider({ text: reply(summary, keywords) });
    const v = await vibe(p, scan, null);
    expect(v.summary.length).toBeGreaterThan(0);
    expect(v.summary.length).toBeLessThanOrEqual(BOUNDS.vibeSummary);
    expect(v.summary.startsWith('calm airy spacious')).toBe(true);
    expect(v.keywords.length).toBeGreaterThan(0);
    expect(v.keywords.length).toBeLessThanOrEqual(Math.min(8, BOUNDS.keywords));
    for (const k of v.keywords) expect(k.length).toBeLessThanOrEqual(BOUNDS.keyword);
    expect(fitsSchema(v)).toBe(true);
  });

  it('T3.35 an over-long one-word keyword is dropped, not cut (its tail may hold a brand)', async () => {
    const p = createMockProvider({ text: reply('Calm.', ['x'.repeat(500), 'calm']) });
    expect((await vibe(p, scan, null)).keywords).toEqual(['calm']);
  });

  it('T3.35 keywords the brand filter empties do not shrink the list', async () => {
    const keywords = [...Array.from({ length: 6 }, () => 'zentrix'), ...'abcdefghij'.split('')];
    const p = createMockProvider({ text: reply('Calm and airy.', keywords) });
    const v = await vibe(p, branded, null);
    expect(v.keywords).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('T3.35 a cut never splits a surrogate pair', async () => {
    const summary = `${'a '.repeat((BOUNDS.vibeSummary - 2) / 2)}a😀 calm`;
    const p = createMockProvider({ text: reply(summary, []) });
    const v = await vibe(p, scan, null);
    expect(v.summary.length).toBeLessThanOrEqual(BOUNDS.vibeSummary);
    expect(v.summary).not.toMatch(/[\ud800-\udbff]$/);
    expect(fitsSchema(v)).toBe(true);
  });

  it('T3.35 a looping non-JSON reply stays within the bound', async () => {
    const p = createMockProvider({ text: 'quiet spacious precise '.repeat(5000) });
    const v = await vibe(p, scan, null);
    expect(v.summary.length).toBeLessThanOrEqual(BOUNDS.vibeSummary);
    expect(fitsSchema(v)).toBe(true);
  });

  it('T3.35 a brand split by the pre-sanitize cut never survives as a fragment', async () => {
    // JSON-escaped, so the whole-reply pass in collect can't see it; only the summary's own pass
    // does. "calm " then "Zentrix " repeated puts the 2 × bound pre-cut inside a brand ("Zen…").
    const n = Math.ceil((2 * BOUNDS.vibeSummary) / 8) + 10;
    const text = `{"summary":"calm ${'Zen\\u0074rix '.repeat(n)}","keywords":[]}`;
    const p = createMockProvider({ text });
    const v = await vibe(p, branded, null);
    expect(v.summary.toLowerCase()).not.toContain('zen');
    expect(v.summary.length).toBeLessThanOrEqual(BOUNDS.vibeSummary);
  });

  it('T3.35 a pre-capped reply that is one long word fails closed as filtered', async () => {
    const p = createMockProvider({ text: reply('a'.repeat(3 * BOUNDS.vibeSummary), []) });
    await expect(vibe(p, scan, null)).rejects.toMatchObject({
      kind: 'other',
      message: VIBE_FILTERED,
    });
  });

  it('T3.35 a summary that is all brand still fails closed as filtered (SPC-32 kept)', async () => {
    const p = createMockProvider({
      text: String.raw`{"summary":"Zen\u0074rix","keywords":["calm"]}`,
    });
    await expect(vibe(p, branded, null)).rejects.toMatchObject({ message: VIBE_FILTERED });
  });

  it('T3.35 the final cut never leaves a brand: a longer word cut to the brand is sanitized (summary)', async () => {
    // Under the pre-cut, so only the final cut applies; it lands inside "zentrixology".
    const summary = `${'calm '.repeat(797)}airy ok zentrixology is calm`;
    const p = createMockProvider({ text: reply(summary, []) });
    const v = await vibe(p, branded, null);
    expect(v.summary.length).toBeLessThanOrEqual(BOUNDS.vibeSummary);
    expect(v.summary.toLowerCase()).not.toMatch(/zentrix\b/);
  });

  it('T3.35 the final cut never leaves a brand (keyword)', async () => {
    const p = createMockProvider({
      text: reply('Calm.', [`${'calm '.repeat(18)}ok zentrixology`, 'airy']),
    });
    const v = await vibe(p, branded, null);
    for (const k of v.keywords) {
      expect(k.length).toBeLessThanOrEqual(BOUNDS.keyword);
      expect(k.toLowerCase()).not.toMatch(/zentrix\b/);
    }
    expect(v.keywords).toContain('airy');
  });

  it('T3.35 non-string keywords are dropped; the summary is not replaced by the raw reply', async () => {
    const p = createMockProvider({
      text: '{"summary":"Calm and airy.","keywords":["calm",1,null,{"a":1},"airy"]}',
    });
    expect(await vibe(p, scan, null)).toMatchObject({
      summary: 'Calm and airy.',
      keywords: ['calm', 'airy'],
    });
  });

  it('T3.35 the non-JSON fallback never splits a surrogate pair', async () => {
    const p = createMockProvider({ text: `${'x'.repeat(279)}😀 rest` });
    const v = await vibe(p, scan, null);
    expect(v.summary).not.toMatch(/[\ud800-\udbff]$/);
    expect(v.summary.length).toBeLessThanOrEqual(280);
  });

  it('T3.35 keywords are unique (case-insensitive), so repeats never fill the slots', async () => {
    const keywords = [
      'calm',
      'Calm',
      'Zentrix calm',
      ...Array.from({ length: 20 }, () => 'calm'),
      'airy',
    ];
    const p = createMockProvider({ text: reply('Calm.', keywords) });
    expect((await vibe(p, branded, null)).keywords).toEqual(['calm', 'airy']);
  });
});
