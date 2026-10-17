import { BOUNDS, type DesignScan, DesignScanSchema } from '@specimen/core/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpError, MID_STREAM_TEXT, TOO_LONG_TEXT, TRUNCATED_TEXT } from '../errors';
import { createGemini } from '../providers/gemini';
import { createOpenAICompat } from '../providers/openaiCompat';
import { createMockProvider } from '../testing/mockProvider';
import { loadFixtureScan, sseResponse } from '../testing/testUtils';
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

  it('T3.35 asks for a budget a thinking model can use, capped at a quarter of a small context (SPC-46, SPC-55)', async () => {
    const big = createMockProvider({ text: JSON_OUT, contextTokens: 1_000_000 });
    await vibe(big, scan, null);
    expect(big.calls[0]?.maxTokens).toBe(10_000);
    const mid = createMockProvider({ text: JSON_OUT, contextTokens: 32_000 });
    await vibe(mid, scan, null);
    expect(mid.calls[0]?.maxTokens).toBe(8000);
    const small = createMockProvider({ text: JSON_OUT, contextTokens: 4096 });
    await vibe(small, scan, null);
    expect(small.calls[0]?.maxTokens).toBe(1024);
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
    expect(base.calls[0]?.json).toBe(true);
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

// Groq reports a JSON-mode failure as an error event inside the 200 stream (SPC-55). These drive
// the real OpenAI-compatible adapter with fake Groq stream bodies; no network.
describe('vibe retries a mid-stream provider error (SPC-55)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ECHO = 'sk-live-ECHOECHOECHO';
  const sse = (...events: unknown[]) =>
    sseResponse([...events.map((e) => `data: ${JSON.stringify(e)}\n\n`), 'data: [DONE]\n\n']);
  const reply = (text: string) =>
    sse(
      { choices: [{ delta: { content: text } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    );
  const jsonFailed = () =>
    sse({
      error: {
        message: `Failed to validate JSON. Please adjust your prompt. key ${ECHO}`,
        type: 'invalid_request_error',
        code: 'json_validate_failed',
      },
    });
  const imageFailed = () =>
    sse({
      error: {
        message: `model does not support image input ${ECHO}`,
        type: 'invalid_request_error',
      },
    });

  type Body = {
    max_tokens?: number;
    response_format?: unknown;
    messages: { role: string; content: unknown }[];
  };
  function stubGroq(respond: (body: Body, n: number) => Response) {
    const bodies: Body[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Body;
        bodies.push(body);
        return respond(body, bodies.length);
      }),
    );
    return bodies;
  }
  const groq = (o: { vision?: boolean; contextTokens?: number } = {}) =>
    createOpenAICompat({
      id: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-20b',
      apiKey: 'gsk_test',
      vision: o.vision ?? false,
      contextTokens: o.contextTokens ?? 131_072,
    });
  const sentImage = (b: Body | undefined) => {
    const c = b?.messages.at(-1)?.content;
    return Array.isArray(c) && c.some((p) => p.type === 'image_url');
  };

  it('T3.35 json_validate_failed mid-stream: retried once with JSON off, same prompt and page data', async () => {
    const bodies = stubGroq((b) => (b.response_format ? jsonFailed() : reply(JSON_OUT)));
    const v = await vibe(groq(), scan, SHOT);
    expect(v).toMatchObject({
      summary: 'Calm and airy.',
      keywords: ['calm', 'airy'],
      usedImage: false,
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.response_format).toEqual({ type: 'json_object' });
    expect(bodies[1]?.response_format).toBeUndefined();
    // Only JSON mode differs: the system prompt and the wrapped page data are kept.
    expect(bodies[1]?.messages).toEqual(bodies[0]?.messages);
    expect(String(bodies[1]?.messages.at(-1)?.content)).toContain('<page_data>');
  });

  it('T3.35 an image rejected mid-stream: retried once text-only with JSON off', async () => {
    const bodies = stubGroq((b) => (sentImage(b) ? imageFailed() : reply(JSON_OUT)));
    const v = await vibe(groq({ vision: true }), scan, SHOT);
    expect(v).toMatchObject({ summary: 'Calm and airy.', usedImage: false });
    expect(bodies).toHaveLength(2);
    expect(sentImage(bodies[0])).toBe(true);
    expect(sentImage(bodies[1])).toBe(false);
    expect(bodies[1]?.response_format).toBeUndefined();
    expect(String(bodies[1]?.messages.at(-1)?.content)).toContain('<page_data>');
  });

  it('T3.35 a retry that fails too is final, with the fixed text and none of the provider text', async () => {
    const bodies = stubGroq(() => jsonFailed());
    const err = await vibe(groq(), scan, null).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'other', message: MID_STREAM_TEXT });
    expect(String((err as Error).message)).not.toContain(ECHO);
    expect(JSON.stringify(err)).not.toContain(ECHO);
    expect(bodies).toHaveLength(2);
  });

  it('T3.35 no retry on a mid-stream rate limit, a cut-off reply, or Stop', async () => {
    const rate = stubGroq(() => sse({ error: { type: 'rate_limit_exceeded', message: ECHO } }));
    await expect(vibe(groq(), scan, null)).rejects.toMatchObject({ kind: 'rate' });
    expect(rate).toHaveLength(1);

    const cut = stubGroq(() =>
      sse({ choices: [{ delta: { content: '{"summary":"Ca' }, finish_reason: 'length' }] }),
    );
    await expect(vibe(groq(), scan, null)).rejects.toMatchObject({ message: TRUNCATED_TEXT });
    expect(cut).toHaveLength(1);

    const ac = new AbortController();
    const stopped = stubGroq(() => {
      ac.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(vibe(groq(), scan, null, ac.signal)).rejects.toMatchObject({ kind: 'aborted' });
    expect(stopped).toHaveLength(1);
  });

  it('T3.35 the JSON-off retry still parses fenced JSON, and prose is sanitized', async () => {
    stubGroq((b) =>
      b.response_format
        ? jsonFailed()
        : reply('Here you go:\n```json\n{"summary":"Calm and airy.","keywords":["calm"]}\n```'),
    );
    expect(await vibe(groq(), scan, null)).toMatchObject({
      summary: 'Calm and airy.',
      keywords: ['calm'],
    });

    const branded: DesignScan = {
      ...scan,
      host: 'zentrix.io',
      url: 'https://zentrix.io/',
      title: 'Zentrix',
    };
    stubGroq((b) =>
      b.response_format ? jsonFailed() : reply('Zentrix feels calm, airy and precise.'),
    );
    const v = await vibe(groq(), branded, null);
    expect(v.summary.toLowerCase()).not.toContain('zentrix');
    expect(v.summary).toContain('calm');
  });

  const tooBig = (limit: number) =>
    new Response(
      JSON.stringify({
        error: {
          message: `max_tokens must be less than or equal to \`${limit}\`, the maximum value for max_tokens is less than the context_window for this model`,
        },
      }),
      { status: 400 },
    );

  it('T3.35 a 400 for the output cap: retried once with the smaller cap, JSON kept', async () => {
    const bodies = stubGroq((b) => ((b.max_tokens ?? 0) > 4096 ? tooBig(4096) : reply(JSON_OUT)));
    expect(await vibe(groq(), scan, null)).toMatchObject({ summary: 'Calm and airy.' });
    expect(bodies.map((b) => b.max_tokens)).toEqual([10_000, 4096]);
    expect(bodies[1]?.response_format).toEqual({ type: 'json_object' });
  });

  it('T3.35 the cap-down is used once; no retry when the cap is already small', async () => {
    const twice = stubGroq(() => tooBig(1000));
    await expect(vibe(groq(), scan, null)).rejects.toMatchObject({ message: TOO_LONG_TEXT });
    expect(twice).toHaveLength(2);
    const small = stubGroq(() => tooBig(1000));
    await expect(vibe(groq({ contextTokens: 8192 }), scan, null)).rejects.toMatchObject({
      message: TOO_LONG_TEXT,
    });
    expect(small).toHaveLength(1);
  });

  it('T3.35 OpenAI o-series rejecting max_tokens itself: one wasted cap-down call, then rethrown', async () => {
    const bodies = stubGroq(
      () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
            },
          }),
          { status: 400 },
        ),
    );
    await expect(vibe(groq(), scan, null)).rejects.toMatchObject({ message: TOO_LONG_TEXT });
    expect(bodies).toHaveLength(2);
  });

  it('T3.35 cap-down, then a mid-stream error, then an error again: exactly 3 calls', async () => {
    const bodies = stubGroq((b, n) =>
      (b.max_tokens ?? 0) > 4096 ? tooBig(4096) : n < 9 ? jsonFailed() : reply(JSON_OUT),
    );
    await expect(vibe(groq(), scan, null)).rejects.toMatchObject({ message: MID_STREAM_TEXT });
    expect(bodies).toHaveLength(3);
    // The smaller cap sticks; only the 3rd call has JSON off.
    expect(bodies.map((b) => b.max_tokens)).toEqual([10_000, 4096, 4096]);
    expect(bodies.map((b) => !!b.response_format)).toEqual([true, true, false]);

    const ok = stubGroq((b, n) =>
      (b.max_tokens ?? 0) > 4096 ? tooBig(4096) : n === 2 ? jsonFailed() : reply(JSON_OUT),
    );
    expect(await vibe(groq(), scan, null)).toMatchObject({ summary: 'Calm and airy.' });
    expect(ok).toHaveLength(3);
  });

  it('T3.35 an image rejected (400) then an error mid-stream: one content retry only', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n++;
        return n === 1
          ? new Response(JSON.stringify({ error: { message: 'image input is not supported' } }), {
              status: 400,
            })
          : jsonFailed();
      }),
    );
    await expect(vibe(groq({ vision: true }), scan, SHOT)).rejects.toMatchObject({
      message: MID_STREAM_TEXT,
    });
    expect(n).toBe(2);
  });

  it('T3.35 Gemini 8k-output models: the generic 400 for maxOutputTokens also caps down', async () => {
    const caps: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        const cap = (
          JSON.parse(String(init?.body)) as { generationConfig: { maxOutputTokens: number } }
        ).generationConfig.maxOutputTokens;
        caps.push(cap);
        if (cap > 8192)
          return new Response(
            JSON.stringify({
              error: {
                code: 400,
                message: `Unable to submit request because it has a maxOutputTokens value of ${cap} but the supported range is from 1 (inclusive) to 8193 (exclusive). Update the value and try again.`,
                status: 'INVALID_ARGUMENT',
              },
            }),
            { status: 400 },
          );
        return sseResponse([
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON_OUT }] }, finishReason: 'STOP' }] })}\n\n`,
        ]);
      }),
    );
    const p = createGemini({
      baseUrl: '',
      model: 'gemini-2.0-flash',
      apiKey: 'AIza-test',
      vision: false,
    });
    expect(await vibe(p, scan, null)).toMatchObject({ summary: 'Calm and airy.' });
    expect(caps).toEqual([10_000, 4096]);
  });
});
