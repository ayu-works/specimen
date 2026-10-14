import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpError, IMAGE_REJECTED_TEXT, mapThrown, scrubLegacyProviderText } from './errors';
import { listModels } from './models';
import { getPreset } from './presets';
import { createAnthropic } from './providers/anthropic';
import { createGemini } from './providers/gemini';
import { createOpenAICompat } from './providers/openaiCompat';
import { drain, sseResponse } from './testing/testUtils';
import type { ChatRequest, LLMProvider } from './types';
import { ProviderError } from './types';

afterEach(() => vi.unstubAllGlobals());

// A fake key, built from parts so secret scanners don't take the test for a leak.
const KEY = ['sk', 'proj', 'AbCdEf0123456789XyZ'].join('-');
const REQ: ChatRequest = { messages: [{ role: 'user', content: 'hi' }] };

/** True when any 8+ character substring of `key` appears in `text`. */
function leaks(text: string, key = KEY): boolean {
  for (let i = 0; i + 8 <= key.length; i++) if (text.includes(key.slice(i, i + 8))) return true;
  return false;
}

/** Everything a UI, a store or a `console.error(err)` could print from an error. */
function serialise(e: unknown): string {
  const err = e as { message?: unknown; stack?: unknown; cause?: unknown };
  const cause = err?.cause as { message?: unknown; stack?: unknown } | undefined;
  let json = '';
  try {
    json = JSON.stringify(e) + JSON.stringify(err?.cause ?? null);
  } catch {
    json = '';
  }
  return [
    String(err?.message),
    String(e),
    String(err?.stack),
    json,
    String(err?.cause),
    String(cause?.message),
    String(cause?.stack),
  ].join('\n');
}

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const f = vi.fn(async (url: string | URL, init?: RequestInit) => impl(String(url), init ?? {}));
  vi.stubGlobal('fetch', f);
  return f;
}

const ADAPTERS: [string, () => LLMProvider][] = [
  ['openai', () => createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm', apiKey: KEY })],
  ['anthropic', () => createAnthropic({ baseUrl: '', model: 'm', apiKey: KEY })],
  ['gemini', () => createGemini({ baseUrl: '', model: 'm', apiKey: KEY })],
];

const failChat = (make: () => LLMProvider) => () => drain(make().chat(REQ));
const failList = () => {
  const p = getPreset('openai');
  if (!p) throw new Error('preset');
  return listModels(p, { baseUrl: p.baseUrl, apiKey: KEY });
};
const CALLS: [string, () => Promise<unknown>][] = [
  ...ADAPTERS.map(([n, m]): [string, () => Promise<unknown>] => [n, failChat(m)]),
  ['listModels', failList],
];

async function caught(run: () => Promise<unknown>): Promise<ProviderError> {
  const e = await run().then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ProviderError);
  return e as ProviderError;
}

const BODIES: [string, string][] = [
  ['openai json', JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } })],
  [
    'gemini json',
    JSON.stringify({ error: { message: `API key not valid: ${KEY}`, status: 'INVALID_ARGUMENT' } }),
  ],
  ['top-level message', JSON.stringify({ message: `bad key ${KEY}` })],
  ['plain text', `unauthorized ${KEY}`],
  ['partial key', `Incorrect API key provided: ${KEY.slice(4, 16)}*****`],
];
const STATUSES = [400, 401, 403, 404, 429, 500, 503, 418];

describe('T3.05 provider errors never carry the API key', () => {
  for (const [name, run] of CALLS) {
    it(`no 8+ character piece of the key in any HTTP error, for every status and body shape (${name})`, async () => {
      for (const status of STATUSES) {
        for (const [, body] of BODIES) {
          stubFetch(() => new Response(body, { status }));
          const e = await caught(run);
          expect(leaks(serialise(e)), `${status} ${body}`).toBe(false);
          expect(e.cause).toBeUndefined();
        }
      }
    });

    it(`a fetch TypeError whose text holds the URL with ?key= maps to fixed network text (${name})`, async () => {
      stubFetch((url) => {
        throw new TypeError(`Failed to fetch ${url}?key=${KEY} (header Bearer ${KEY})`);
      });
      const e = await caught(run);
      expect(e.kind).toBe('network');
      expect(leaks(serialise(e))).toBe(false);
      expect(e.cause).toBeUndefined();
    });

    it(`an unknown throw on the HTTP path maps to fixed text (${name})`, async () => {
      stubFetch(() => {
        throw new Error(`weird failure with ${KEY}`);
      });
      const e = await caught(run);
      expect(e.kind).toBe('other');
      expect(e.message).toBe('The provider request failed.');
      expect(leaks(serialise(e))).toBe(false);
    });
  }

  for (const [name, make] of ADAPTERS) {
    it(`a mid-stream error event rejects with fixed text and no key (${name})`, async () => {
      const ev =
        name === 'anthropic'
          ? { type: 'error', error: { type: 'api_error', message: `bad ${KEY}` } }
          : { error: { message: `Incorrect API key provided: ${KEY}`, code: 'invalid_api_key' } };
      stubFetch(() =>
        sseResponse([
          name === 'anthropic'
            ? 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"a"}}\n\n'
            : name === 'gemini'
              ? 'data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\n\n'
              : 'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
          `data: ${JSON.stringify(ev)}\n\n`,
          'data: [DONE]\n\n',
        ]),
      );
      const e = await caught(failChat(make));
      expect(e.kind).toBe('other');
      expect(e.message).toBe('The provider reported an error mid-response.');
      expect(leaks(serialise(e))).toBe(false);
    });

    it(`a mid-stream rate-limit / overload event maps to kind "rate" (${name})`, async () => {
      const ev =
        name === 'anthropic'
          ? { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
          : name === 'gemini'
            ? { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } }
            : { error: { message: 'Rate limit reached', type: 'rate_limit_exceeded' } };
      stubFetch(() => sseResponse([`data: ${JSON.stringify(ev)}\n\n`]));
      expect((await caught(failChat(make))).kind).toBe('rate');
    });
  }
});

describe('T3.05 httpError keeps classifying with fixed text', () => {
  const res = (status: number, message: string) =>
    new Response(JSON.stringify({ error: { message } }), { status });

  it('maps statuses and body hints to kinds and fixed messages', async () => {
    expect(await httpError(res(401, 'x'))).toMatchObject({
      kind: 'auth',
      message: "Invalid API key, or the key can't use this model.",
    });
    expect(await httpError(res(400, 'API key not valid'))).toMatchObject({
      kind: 'auth',
      message: 'Invalid API key.',
    });
    expect((await httpError(res(400, 'The model `x` does not exist'))).message).toMatch(
      /Fetch models/,
    );
    expect((await httpError(res(400, 'rate_limit hit'))).kind).toBe('rate');
    expect((await httpError(res(502, 'boom'))).message).toBe(
      'The provider had a server error. Try again in a minute.',
    );
    expect((await httpError(res(422, 'boom'))).message).toBe('Request failed with HTTP 422.');
  });

  it('a 400 that rejects the image gets the fixed image text', async () => {
    for (const m of [
      'messages.0.content must be a string',
      'image_url is only supported by certain models',
      'This model does not support multimodal input',
    ]) {
      const e = await httpError(res(400, m));
      expect(e.kind).toBe('other');
      expect(e.message).toBe(IMAGE_REJECTED_TEXT);
    }
  });

  it('an unreadable body still yields a fixed message', async () => {
    const r = new Response('x', { status: 401 });
    vi.spyOn(r, 'text').mockRejectedValue(new Error(KEY));
    const e = await httpError(r);
    expect(e.kind).toBe('auth');
    expect(leaks(serialise(e))).toBe(false);
  });

  it('mapThrown without fixedText keeps the message and cause (chromeBuiltin path)', () => {
    const e = mapThrown(new Error('NotSupportedError: no model'));
    expect(e.message).toBe('NotSupportedError: no model');
    expect(e.cause).toBeInstanceOf(Error);
  });
});

describe('T3.05 scrubLegacyProviderText', () => {
  it('strips the old (detail) suffix after the old message prefixes', () => {
    const cases: [string, string][] = [
      [
        `Invalid API key, or the key can't use this model (Incorrect API key provided: ${KEY})`,
        "Invalid API key, or the key can't use this model",
      ],
      [`Invalid API key (API key not valid: ${KEY})`, 'Invalid API key'],
      [
        `This model isn't available for your key. In Settings, click "Fetch models" and pick one (model x not found ${KEY})`,
        `This model isn't available for your key. In Settings, click "Fetch models" and pick one`,
      ],
      [
        'The provider had a server error (upstream (nested) fail)',
        'The provider had a server error',
      ],
      [`Request failed with HTTP 418 (teapot ${KEY})`, 'Request failed with HTTP 418'],
    ];
    for (const [old, want] of cases) expect(scrubLegacyProviderText(old)).toBe(want);
  });

  it('redacts key shapes anywhere in other text', () => {
    const keys = [
      KEY,
      'sk-ant-api03-AbCdEf0123456789_-XyZ',
      'gsk_AbCdEf0123456789XyZabc',
      'AIzaSyAbCdEf0123456789XyZ_-abc',
      'sk-AbCdEf0123456789XyZ',
    ];
    for (const k of keys) {
      const out = scrubLegacyProviderText(`Something broke: ${k}, sorry`);
      expect(leaks(out, k), out).toBe(false);
      expect(out).toContain('Something broke:');
    }
  });

  it('leaves ordinary text alone', () => {
    for (const t of [
      'Stopped',
      'The model returned nothing.',
      'task-runner (sky)',
      'Ask: skip it',
    ]) {
      expect(scrubLegacyProviderText(t)).toBe(t);
    }
  });
});
