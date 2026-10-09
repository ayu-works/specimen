import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPreset } from '../presets';
import { drain, hangingResponse, sseResponse } from '../testing/testUtils';
import type { ChatRequest, LLMProvider } from '../types';
import { ProviderError } from '../types';
import { createAnthropic } from './anthropic';
import { createGemini } from './gemini';
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

  it('T3.03 surfaces a stream error event as a ProviderError', async () => {
    stubFetch(() => sseResponse(['data: {"type":"error","error":{"message":"overloaded"}}\n\n']));
    await expect(drain(createAnthropic(cfg).chat(REQ))).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'other',
      message: 'overloaded',
    });
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
        'ts":[{"text":"lo"},{"text":"!"}]}}]}\n\n',
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
