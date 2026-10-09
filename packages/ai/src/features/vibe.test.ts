import { describe, expect, it } from 'vitest';
import { createMockProvider } from '../testing/mockProvider';
import { loadFixtureScan } from '../testing/testUtils';
import { ProviderError } from '../types';
import { vibe } from './vibe';

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
          throw new ProviderError(
            'other',
            'Request failed with HTTP 400 (messages.0.content must be a string)',
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
