import { afterEach, describe, expect, it, vi } from 'vitest';
import { MID_STREAM_TEXT, TRUNCATED_TEXT } from '../errors';
import { getPreset } from '../presets';
import { drain, hangingResponse, sseResponse } from '../testing/testUtils';
import type { ChatRequest, LLMProvider } from '../types';
import { ProviderError } from '../types';
import { createAnthropic } from './anthropic';
import { createGemini } from './gemini';
import { CUT_SHORT_TEXT, FILTERED_TEXT } from './http';
import { buildOpenAIRequest, createOpenAICompat } from './openaiCompat';

afterEach(() => vi.unstubAllGlobals());

const REQ: ChatRequest = {
  system: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 50,
  temperature: 0.2,
};

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const f = vi.fn(async (url: string | URL, init?: RequestInit) => impl(String(url), init ?? {}));
  vi.stubGlobal('fetch', f);
  return f;
}
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe('openaiCompat', () => {
  const cases: [string, string, boolean][] = [
    ['openai', 'https://api.openai.com/v1/chat/completions', true],
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions', true],
    ['groq', 'https://api.groq.com/openai/v1/chat/completions', true],
    ['ollama', 'http://localhost:11434/v1/chat/completions', false],
  ];
  for (const [id, url, needsKey] of cases) {
    it(`T3.02 builds the request for the ${id} preset`, () => {
      const p = getPreset(id);
      expect(p).toBeDefined();
      if (!p) return;
      expect(p.needsKey).toBe(needsKey);
      const r = buildOpenAIRequest(
        { baseUrl: p.baseUrl, model: p.model, apiKey: needsKey ? 'sk-test' : undefined },
        REQ,
      );
      expect(r.url).toBe(url);
      if (needsKey) expect(r.headers.authorization).toBe('Bearer sk-test');
      else expect(r.headers.authorization).toBeUndefined();
      expect(r.body).toMatchObject({
        model: p.model,
        stream: true,
        max_tokens: 50,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
      });
    });
  }

  it('T3.02 supports a custom base URL (trailing slashes trimmed) and json mode', () => {
    const r = buildOpenAIRequest(
      { baseUrl: 'https://llm.example.com/v9//', model: 'm', apiKey: 'k' },
      { ...REQ, json: true },
    );
    expect(r.url).toBe('https://llm.example.com/v9/chat/completions');
    expect(r.body.response_format).toEqual({ type: 'json_object' });
  });

  it('T3.02 sends image parts in the OpenAI image_url format', () => {
    const r = buildOpenAIRequest(
      { baseUrl: 'https://x/v1', model: 'm' },
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              { type: 'image', dataUrl: 'data:image/png;base64,AAAA' },
            ],
          },
        ],
      },
    );
    const msgs = r.body.messages as { content: unknown }[];
    expect(msgs[0]?.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  it('T3.02 posts to the built URL and parses a canned SSE stream with split lines and [DONE]', async () => {
    const f = stubFetch(() =>
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"con',
        'tent":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\r\n\r\n',
        ': keep-alive\n\n',
        'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
        'data: [DONE]\n\n',
        'data: {"choices":[{"delta":{"content":"IGNORED"}}]}\n\n',
      ]),
    );
    const p = createOpenAICompat({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt',
      apiKey: 'k',
    });
    expect(await drain(p.chat(REQ))).toBe('Hello there');
    const [url, init] = f.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(headersOf(init as RequestInit).authorization).toBe('Bearer k');
    expect((init as RequestInit).credentials).toBe('omit');
    expect(JSON.parse(String((init as RequestInit).body)).stream).toBe(true);
  });

  it('T3.02 status needs a key only when the preset requires one', async () => {
    const withKey = createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm' });
    expect((await withKey.status()).state).toBe('needs-setup');
    const ollama = createOpenAICompat({
      baseUrl: 'http://localhost:11434/v1',
      model: 'm',
      needsKey: false,
    });
    expect((await ollama.status()).state).toBe('ready');
  });
});

describe('anthropic', () => {
  const cfg = { baseUrl: 'https://api.anthropic.com', model: 'claude-x', apiKey: 'sk-ant-test' };

  it('T3.03 sends the key, version and direct-browser-access headers and parses content_block_delta', async () => {
    const f = stubFetch(() =>
      sseResponse([
        'event: message_start\ndata: {"type":"message_start"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"x"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" you"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );
    const out = await drain(createAnthropic(cfg).chat({ ...REQ, json: true }));
    expect(out).toBe('Hi you');
    const [url, init] = f.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    const h = headersOf(init as RequestInit);
    expect(h['x-api-key']).toBe('sk-ant-test');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.stream).toBe(true);
    expect(body.system).toContain('sys');
    expect(body.system).toContain('valid JSON');
  });

  it('T3.03 converts images to base64 source blocks', async () => {
    const f = stubFetch(() => sseResponse(['data: {"type":"message_stop"}\n\n']));
    await drain(
      createAnthropic(cfg).chat({
        messages: [
          { role: 'user', content: [{ type: 'image', dataUrl: 'data:image/png;base64,QUJD' }] },
        ],
      }),
    );
    const body = JSON.parse(String(f.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
    });
  });

  it('T3.03 surfaces a stream error event as a ProviderError with fixed text', async () => {
    stubFetch(() =>
      sseResponse(['data: {"type":"error","error":{"type":"api_error","message":"boom"}}\n\n']),
    );
    await expect(drain(createAnthropic(cfg).chat(REQ))).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'other',
      message: 'The provider reported an error mid-response.',
    });
  });

  it('T3.03 a stream that ends without message_stop rejects as cut off, after the partial text', async () => {
    stubFetch(() =>
      sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hal"}}\n\n',
      ]),
    );
    const seen: string[] = [];
    const run = (async () => {
      for await (const d of createAnthropic(cfg).chat(REQ)) seen.push(d);
    })();
    await expect(run).rejects.toMatchObject({ kind: 'other', message: /cut off/ });
    expect(seen).toEqual(['Hal']);
  });
});

describe('gemini', () => {
  const cfg = {
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    apiKey: 'AIza-secret',
  };

  it('T3.04 uses the x-goog-api-key header, keeps the key out of the URL, and parses the stream', async () => {
    const f = stubFetch(() =>
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"par',
        'ts":[{"text":"lo"},{"text":"!"}]},"finishReason":"STOP"}]}\n\n',
        'data: not-json\n\n',
      ]),
    );
    const out = await drain(createGemini(cfg).chat({ ...REQ, json: true }));
    expect(out).toBe('Hello!');
    const [url, init] = f.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    );
    expect(String(url)).not.toContain('AIza-secret');
    expect(String(url)).not.toContain('key=');
    expect(headersOf(init as RequestInit)['x-goog-api-key']).toBe('AIza-secret');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.systemInstruction.parts[0].text).toBe('sys');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'hi' }] });
  });
});

describe('empty and missing bodies (M1)', () => {
  const adapters: [string, string, () => LLMProvider][] = [
    [
      'openai',
      'T3.02',
      () => createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' }),
    ],
    ['anthropic', 'T3.03', () => createAnthropic({ baseUrl: '', model: 'm', apiKey: 'k' })],
    ['gemini', 'T3.04', () => createGemini({ baseUrl: '', model: 'm', apiKey: 'k' })],
  ];
  for (const [name, id, make] of adapters) {
    it(`${id} an empty 200 stream rejects instead of succeeding (${name})`, async () => {
      stubFetch(() => sseResponse([]));
      await expect(drain(make().chat(REQ))).rejects.toMatchObject({ name: 'ProviderError' });
    });

    it(`${id} a 200 with no body rejects as an empty response (${name})`, async () => {
      stubFetch(() => new Response(null, { status: 200 }));
      await expect(drain(make().chat(REQ))).rejects.toMatchObject({
        kind: 'other',
        message: 'The provider returned an empty response',
      });
    });
  }

  it('T3.02 events with no text, no finish_reason and no [DONE] reject as cut off (SPC-46)', async () => {
    stubFetch(() => sseResponse(['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n']));
    await expect(
      drain(createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' }).chat(REQ)),
    ).rejects.toMatchObject({ kind: 'other', message: CUT_SHORT_TEXT });
  });
});

describe('error mapping', () => {
  const adapters: [string, () => LLMProvider][] = [
    ['openai', () => createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' })],
    ['anthropic', () => createAnthropic({ baseUrl: '', model: 'm', apiKey: 'k' })],
    ['gemini', () => createGemini({ baseUrl: '', model: 'm', apiKey: 'k' })],
  ];
  const json = (status: number, message: string) =>
    new Response(JSON.stringify({ error: { message } }), { status });

  for (const [name, make] of adapters) {
    it(`T3.05 maps HTTP statuses to friendly errors (${name})`, async () => {
      const kindFor = async (res: () => Response) => {
        stubFetch(res);
        return drain(make().chat(REQ)).then(
          () => null,
          (e: ProviderError) => e,
        );
      };
      const auth401 = await kindFor(() => json(401, 'bad key'));
      expect(auth401).toBeInstanceOf(ProviderError);
      expect(auth401?.kind).toBe('auth');
      expect(auth401?.message).toMatch(/Invalid API key/);
      expect((await kindFor(() => json(403, 'nope')))?.kind).toBe('auth');
      expect((await kindFor(() => json(429, 'slow down')))?.kind).toBe('rate');
      const nf = await kindFor(() => json(404, 'no such thing'));
      expect(nf?.kind).toBe('other');
      expect(nf?.message).toMatch(/Fetch models/);
      const gone = await kindFor(() => json(400, 'The model `x` does not exist'));
      expect(gone?.message).toMatch(/Fetch models/);
      const s5 = await kindFor(() => json(503, 'oops'));
      expect(s5?.kind).toBe('other');
      expect(s5?.message).toMatch(/server error/);
      const net = await kindFor(() => {
        throw new TypeError('Failed to fetch');
      });
      expect(net?.kind).toBe('network');
    });
  }

  it('T3.05 error messages never include the API key', async () => {
    stubFetch(() => json(401, 'bad'));
    const e = await drain(
      createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'sk-very-secret' }).chat(
        REQ,
      ),
    ).catch((x: ProviderError) => x);
    expect(String((e as Error).message)).not.toContain('sk-very-secret');
  });
});

describe('abort', () => {
  const adapters: [string, () => LLMProvider][] = [
    ['openai', () => createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' })],
    ['anthropic', () => createAnthropic({ baseUrl: '', model: 'm', apiKey: 'k' })],
    ['gemini', () => createGemini({ baseUrl: '', model: 'm', apiKey: 'k' })],
  ];
  for (const [name, make] of adapters) {
    it(`T3.06 aborting mid-stream rejects with kind "aborted" (${name})`, async () => {
      const ac = new AbortController();
      stubFetch((_u, init) => hangingResponse(init.signal as AbortSignal));
      const it = make().chat(REQ, ac.signal);
      const run = drain(it);
      setTimeout(() => ac.abort(), 10);
      await expect(run).rejects.toMatchObject({ name: 'ProviderError', kind: 'aborted' });
    });

    it(`T3.06 an already-aborted signal never hits the network (${name})`, async () => {
      const ac = new AbortController();
      ac.abort();
      const f = stubFetch(() => sseResponse([]));
      await expect(drain(make().chat(REQ, ac.signal))).rejects.toMatchObject({ kind: 'aborted' });
      expect(f).not.toHaveBeenCalled();
    });

    it(`T3.06 a fetch rejecting with AbortError maps to "aborted" (${name})`, async () => {
      stubFetch(() => {
        throw new DOMException('Aborted', 'AbortError');
      });
      await expect(drain(make().chat(REQ))).rejects.toMatchObject({ kind: 'aborted' });
    });
  }
});

describe('a reply cut off at the token limit (SPC-41)', () => {
  const KEY = 'sk-ant-very-secret-key';
  const oai = () => createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm', apiKey: KEY });
  const ant = () => createAnthropic({ baseUrl: '', model: '', apiKey: KEY });
  const gem = () => createGemini({ baseUrl: '', model: '', apiKey: KEY });
  const oaiChunk = (content: string | null, finish: string | null) =>
    `data: ${JSON.stringify({ choices: [{ delta: content === null ? {} : { content }, finish_reason: finish }] })}\n\n`;
  const antText = (text: string) =>
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`;
  const antStop = (stop_reason: string) => [
    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason } })}\n\n`,
    'data: {"type":"message_stop"}\n\n',
  ];
  const gemChunk = (text: string | null, finishReason?: string) =>
    `data: ${JSON.stringify({ candidates: [{ content: { parts: text === null ? [] : [{ text }] }, finishReason }] })}\n\n`;

  /** Collect the deltas and the error, like a caller that keeps the partial text. */
  async function run(p: LLMProvider) {
    const seen: string[] = [];
    let error: unknown;
    try {
      for await (const d of p.chat(REQ)) seen.push(d);
    } catch (e) {
      error = e;
    }
    return { seen, error };
  }
  function expectTruncated(error: unknown) {
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'other', message: TRUNCATED_TEXT });
    const e = error as ProviderError;
    expect(e.cause).toBeUndefined();
    for (const s of [e.message, String(e), JSON.stringify(e), e.stack ?? '']) {
      expect(s).not.toContain(KEY);
    }
  }

  const cut: [string, () => LLMProvider, string[], string][] = [
    [
      'T3.02 openaiCompat: the last text and finish_reason "length" in one chunk',
      oai,
      [oaiChunk('Hel', null), oaiChunk('lo', 'length'), 'data: [DONE]\n\n'],
      'Hello',
    ],
    [
      'T3.02 openaiCompat: an empty-delta chunk with finish_reason "length" after the text',
      oai,
      [oaiChunk('Hel', null), oaiChunk('lo', null), oaiChunk(null, 'length'), 'data: [DONE]\n\n'],
      'Hello',
    ],
    [
      'T3.02 openaiCompat: Mistral\'s finish_reason "model_length" (context window full)',
      oai,
      [oaiChunk('Hel', null), oaiChunk('lo', 'model_length'), 'data: [DONE]\n\n'],
      'Hello',
    ],
    [
      'T3.03 anthropic: stop_reason "max_tokens"',
      ant,
      [antText('Hel'), antText('lo'), ...antStop('max_tokens')],
      'Hello',
    ],
    [
      'T3.03 anthropic: stop_reason "model_context_window_exceeded"',
      ant,
      [antText('Hel'), antText('lo'), ...antStop('model_context_window_exceeded')],
      'Hello',
    ],
    [
      'T3.04 gemini: finishReason "MAX_TOKENS" on the chunk with the last text',
      gem,
      [gemChunk('Hel'), gemChunk('lo', 'MAX_TOKENS')],
      'Hello',
    ],
    [
      'T3.04 gemini: finishReason "MAX_TOKENS" then a chunk with no text (one throw, no lost text)',
      gem,
      [gemChunk('Hel'), gemChunk('lo', 'MAX_TOKENS'), gemChunk(null, 'MAX_TOKENS'), gemChunk('!')],
      'Hello',
    ],
  ];
  for (const [name, make, chunks, text] of cut) {
    it(`${name} rejects with TRUNCATED_TEXT after the partial text`, async () => {
      stubFetch(() => sseResponse(chunks));
      const { seen, error } = await run(make());
      expect(seen.join('')).toBe(text);
      expectTruncated(error);
    });
  }

  const whole: [string, () => LLMProvider, string[]][] = [
    [
      'T3.02 openaiCompat: finish_reason "stop"',
      oai,
      [oaiChunk('Hel', null), oaiChunk('lo', null), oaiChunk(null, 'stop'), 'data: [DONE]\n\n'],
    ],
    [
      'T3.03 anthropic: stop_reason "end_turn"',
      ant,
      [antText('Hel'), antText('lo'), ...antStop('end_turn')],
    ],
    ['T3.04 gemini: finishReason "STOP"', gem, [gemChunk('Hel'), gemChunk('lo', 'STOP')]],
    // Other stop reasons are not a token-limit cut-off: an exact-value match must not widen.
    ...['tool_calls'].map((r): [string, () => LLMProvider, string[]] => [
      `T3.02 openaiCompat: finish_reason "${r}"`,
      oai,
      [oaiChunk('Hel', null), oaiChunk('lo', r), 'data: [DONE]\n\n'],
    ]),
    ...['stop_sequence', 'tool_use', 'pause_turn'].map(
      (r): [string, () => LLMProvider, string[]] => [
        `T3.03 anthropic: stop_reason "${r}"`,
        ant,
        [antText('Hel'), antText('lo'), ...antStop(r)],
      ],
    ),
    ...['OTHER', 'LANGUAGE'].map((r): [string, () => LLMProvider, string[]] => [
      `T3.04 gemini: finishReason "${r}"`,
      gem,
      [gemChunk('Hel'), gemChunk('lo', r)],
    ]),
  ];
  for (const [name, make, chunks] of whole) {
    it(`${name} still ends as a whole reply`, async () => {
      stubFetch(() => sseResponse(chunks));
      const { seen, error } = await run(make());
      expect(error).toBeUndefined();
      expect(seen.join('')).toBe('Hello');
    });
  }
});

describe('a stream with no stop reason, or stopped by a filter or a provider error (SPC-46)', () => {
  const KEY = 'sk-ant-very-secret-key';
  const oai = () => createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm', apiKey: KEY });
  const ant = () => createAnthropic({ baseUrl: '', model: '', apiKey: KEY });
  const gem = () => createGemini({ baseUrl: '', model: '', apiKey: KEY });
  const oaiChunk = (content: string | null, finish: string | null) =>
    `data: ${JSON.stringify({ choices: [{ delta: content === null ? {} : { content }, finish_reason: finish }] })}\n\n`;
  const antText = (text: string) =>
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`;
  const antStop = (stop_reason: string) => [
    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason } })}\n\n`,
    'data: {"type":"message_stop"}\n\n',
  ];
  const gemChunk = (text: string | null, finishReason?: string) =>
    `data: ${JSON.stringify({ candidates: [{ content: { parts: text === null ? [] : [{ text }] }, finishReason }] })}\n\n`;

  async function run(p: LLMProvider) {
    const seen: string[] = [];
    let error: unknown;
    try {
      for await (const d of p.chat(REQ)) seen.push(d);
    } catch (e) {
      error = e;
    }
    return { seen, error };
  }
  function expectFixed(error: unknown, message: string) {
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'other', message });
    const e = error as ProviderError;
    expect(e.cause).toBeUndefined();
    for (const s of [e.message, String(e), JSON.stringify(e), e.stack ?? '']) {
      expect(s).not.toContain(KEY);
    }
  }

  type Case = [string, () => LLMProvider, string[], string, string];
  const failing: Case[] = [
    // L1: the stream closed cleanly before the provider said it was done.
    [
      'T3.02 openaiCompat: text then EOF with no finish_reason and no [DONE]',
      oai,
      [oaiChunk('Hel', null), oaiChunk('lo', null)],
      'Hello',
      CUT_SHORT_TEXT,
    ],
    [
      'T3.03 anthropic: text then EOF with no message_stop',
      ant,
      [antText('Hel'), antText('lo')],
      'Hello',
      CUT_SHORT_TEXT,
    ],
    [
      'T3.04 gemini: text then EOF with no finishReason',
      gem,
      [gemChunk('Hel'), gemChunk('lo')],
      'Hello',
      CUT_SHORT_TEXT,
    ],
    // L2: a filter stop, after the chunk's own text, once; later chunks are ignored.
    [
      'T3.02 openaiCompat: finish_reason "content_filter"',
      oai,
      [
        oaiChunk('Hel', null),
        oaiChunk('lo', 'content_filter'),
        oaiChunk('!', null),
        'data: [DONE]\n\n',
      ],
      'Hello',
      FILTERED_TEXT,
    ],
    [
      'T3.03 anthropic: stop_reason "refusal"',
      ant,
      [antText('Hel'), antText('lo'), ...antStop('refusal'), antText('!')],
      'Hello',
      FILTERED_TEXT,
    ],
    ...['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].map(
      (r): Case => [
        `T3.04 gemini: finishReason "${r}"`,
        gem,
        [gemChunk('Hel'), gemChunk('lo', r), gemChunk('!', 'STOP')],
        'Hello',
        FILTERED_TEXT,
      ],
    ),
    [
      'T3.04 gemini: a prompt blocked by promptFeedback.blockReason (no candidates)',
      gem,
      [`data: ${JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })}\n\n`],
      '',
      FILTERED_TEXT,
    ],
    // L2: a provider-side error stop.
    ...['error', 'insufficient_system_resource'].map(
      (r): Case => [
        `T3.02 openaiCompat: finish_reason "${r}"`,
        oai,
        [oaiChunk('Hel', null), oaiChunk('lo', r), 'data: [DONE]\n\n'],
        'Hello',
        MID_STREAM_TEXT,
      ],
    ),
  ];
  for (const [name, make, chunks, text, message] of failing) {
    it(`${name} rejects with fixed text after the partial text`, async () => {
      stubFetch(() => sseResponse(chunks));
      const { seen, error } = await run(make());
      expect(seen.join('')).toBe(text);
      expectFixed(error, message);
    });
  }

  const whole: [string, () => LLMProvider, string[]][] = [
    [
      'T3.02 openaiCompat: [DONE] with no finish_reason (Ollama-style local server)',
      oai,
      [oaiChunk('Hel', null), oaiChunk('lo', null), 'data: [DONE]\n\n'],
    ],
    [
      'T3.02 openaiCompat: finish_reason "stop" with no [DONE]',
      oai,
      [oaiChunk('Hel', null), oaiChunk('lo', 'stop')],
    ],
    [
      'T3.04 gemini: finishReason "STOP" then a trailing chunk with none',
      gem,
      [gemChunk('Hel'), gemChunk('lo', 'STOP'), gemChunk(null)],
    ],
  ];
  for (const [name, make, chunks] of whole) {
    it(`${name} still ends as a whole reply`, async () => {
      stubFetch(() => sseResponse(chunks));
      const { seen, error } = await run(make());
      expect(error).toBeUndefined();
      expect(seen.join('')).toBe('Hello');
    });
  }
});
