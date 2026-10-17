import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  httpError,
  IMAGE_REJECTED_TEXT,
  mapThrown,
  OUT_OF_CREDIT_TEXT,
  RATE_TEXT,
  scrubLegacyProviderText,
  streamError,
  TOO_LONG_TEXT,
} from './errors';
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

  it('a 400 saying a vision model is deprecated is "model unavailable", not an image rejection', async () => {
    const e = await httpError(res(400, 'The model `gpt-4-vision-preview` has been deprecated'));
    expect(e.message).toMatch(/Fetch models/);
    expect(e.message).not.toBe(IMAGE_REJECTED_TEXT);
  });

  it('a 400 naming a decommissioned "-vision" model is model-gone, not an image rejection', async () => {
    const e = await httpError(
      res(
        400,
        'The model `llama-3.2-90b-vision-preview` has been decommissioned and is no longer supported',
      ),
    );
    expect(e.message).toMatch(/Fetch models/);
  });

  it('a 400 that only mentions an image (e.g. too large) is not an image rejection', async () => {
    const e = await httpError(res(400, 'Image too large: max 20MB'));
    expect(e.message).not.toBe(IMAGE_REJECTED_TEXT);
    expect(e.message).toMatch(/rejected the request \(HTTP 400\)/);
  });

  it('a context-length or max_tokens 400 gets the fixed "too long" text', async () => {
    for (const [status, m] of [
      [400, "This model's maximum context length is 8192 tokens"],
      [400, 'max_tokens is too large: 9000'],
      [413, 'Request too large for model'],
      [400, 'prompt is too long: 210000 tokens > 200000 maximum'],
    ] as const) {
      const e = await httpError(res(status, m));
      expect(e).toMatchObject({ kind: 'other', message: TOO_LONG_TEXT });
    }
    const code = new Response(
      JSON.stringify({ error: { message: 'x', code: 'context_length_exceeded' } }),
      {
        status: 400,
      },
    );
    // Only the message is classified; a bare code still gets the fixed 400 text, never the body.
    expect((await httpError(code)).message).toMatch(/HTTP 400/);
  });

  it('a 400 that rejects the image gets the fixed image text', async () => {
    for (const m of [
      'messages.0.content must be a string',
      'image_url is only supported by certain models',
      'This model does not support multimodal input',
      'Image input is not supported for this model',
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

describe('T3.05 out of credit is its own fixed text, not a rate limit (SPC-30)', () => {
  const body = (status: number, error: unknown) =>
    new Response(JSON.stringify({ error }), { status });
  const QUOTA_MSG = 'You exceeded your current quota, please check your plan and billing details.';
  const OUT = { kind: 'other', message: OUT_OF_CREDIT_TEXT };

  it("OpenAI's 429 insufficient_quota is out of credit, by code or by type", async () => {
    const full = { message: QUOTA_MSG, type: 'insufficient_quota', code: 'insufficient_quota' };
    // Exact text: the Settings Test only special-cases TRUNCATED_TEXT, so this shows as an error.
    expect(await httpError(body(429, full))).toMatchObject(OUT);
    expect((await httpError(body(429, full))).message).toBe(OUT_OF_CREDIT_TEXT);
    expect(
      await httpError(body(429, { message: QUOTA_MSG, code: 'insufficient_quota' })),
    ).toMatchObject(OUT);
    expect(
      await httpError(body(429, { message: QUOTA_MSG, type: 'insufficient_quota' })),
    ).toMatchObject(OUT);
    expect(
      await httpError(body(400, { message: 'x', code: 'billing_hard_limit_reached' })),
    ).toMatchObject(OUT);
    // No active billing (new account, card removed): OpenAI sends it as a 429 too.
    const inactive = {
      message: 'Your account is not active, please check your billing details on our website.',
      type: 'billing_not_active',
      code: 'billing_not_active',
    };
    expect(await httpError(body(429, inactive))).toMatchObject(OUT);
  });

  it('a gateway that flattens the error still gets out of credit by code', async () => {
    expect(await httpError(body(429, 'insufficient_quota'))).toMatchObject(OUT);
    const flat = new Response(JSON.stringify({ code: 'insufficient_quota', message: QUOTA_MSG }), {
      status: 429,
    });
    expect(await httpError(flat)).toMatchObject(OUT);
  });

  it('a 402 is out of credit, even with an unreadable body', async () => {
    expect(await httpError(body(402, { message: 'Insufficient Balance' }))).toMatchObject(OUT);
    expect(await httpError(new Response('', { status: 402 }))).toMatchObject(OUT);
    const r = new Response('x', { status: 402 });
    vi.spyOn(r, 'text').mockRejectedValue(new Error(KEY));
    expect(await httpError(r)).toMatchObject(OUT);
  });

  it('credit wording beats the 400/403 branches (Anthropic, xAI), checked before auth', async () => {
    const anthropic = {
      type: 'invalid_request_error',
      message:
        'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    };
    expect(await httpError(body(400, anthropic))).toMatchObject(OUT);
    const xai = { message: "Your team doesn't have any credits yet. Purchase them first." };
    expect(await httpError(body(403, xai))).toMatchObject(OUT);
    // A 403 for anything else is still auth.
    expect((await httpError(body(403, { message: 'permission denied' }))).kind).toBe('auth');
  });

  it('a plain 429 and Gemini quota 429s stay a rate limit (they clear by waiting)', async () => {
    for (const r of [
      new Response('', { status: 429 }),
      body(429, {
        message: 'Rate limit reached for gpt-4o',
        type: 'requests',
        code: 'rate_limit_exceeded',
      }),
      // Gemini's per-minute limit uses the same words as OpenAI's out-of-credit message.
      body(429, { code: 429, status: 'RESOURCE_EXHAUSTED', message: QUOTA_MSG }),
      body(429, {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message:
          'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 50 per day',
      }),
    ]) {
      expect(await httpError(r)).toMatchObject({ kind: 'rate', message: RATE_TEXT });
    }
  });

  it('only string code/type fields count, and no body text reaches the message', async () => {
    expect((await httpError(body(429, { code: 429, message: 'insufficient_quota' }))).kind).toBe(
      'rate',
    );
    const e = await httpError(body(429, { code: 'insufficient_quota', message: `bad key ${KEY}` }));
    expect(e.message).toBe(OUT_OF_CREDIT_TEXT);
    expect(leaks(serialise(e))).toBe(false);
  });

  it('reaches the caller through the openaiCompat adapter unchanged', async () => {
    stubFetch(() =>
      body(429, { message: QUOTA_MSG, type: 'insufficient_quota', code: 'insufficient_quota' }),
    );
    const e = await caught(
      failChat(() => createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm', apiKey: KEY })),
    );
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toMatchObject(OUT);
  });

  it('a mid-stream insufficient_quota event is out of credit; a rate event stays rate', () => {
    expect(streamError({ code: 'insufficient_quota', type: 'insufficient_quota' })).toMatchObject(
      OUT,
    );
    expect(streamError({ code: 'billing_not_active' })).toMatchObject(OUT);
    // OpenRouter reports a mid-stream error with a numeric code.
    expect(streamError({ code: 402, message: 'Insufficient credits' })).toMatchObject(OUT);
    expect(streamError({ type: 'rate_limit_exceeded' }).kind).toBe('rate');
    expect(streamError({ status: 'RESOURCE_EXHAUSTED' }).kind).toBe('rate');
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
      ['xai', 'AbCdEf0123456789XyZabc'].join('-'),
      'ab12'.repeat(16), // 64 hex, Together-style
      ['AbCdEf0123456789', 'XyZabc0123456789'].join(''), // 32 alphanumerics, Mistral-style
    ];
    for (const k of keys) {
      const out = scrubLegacyProviderText(`Something broke: ${k}, sorry`);
      expect(leaks(out, k), out).toBe(false);
      expect(out).toContain('Something broke:');
    }
  });

  it('only strips the suffix when the whole string is an old message', () => {
    const t = 'Return Invalid API key (401) from your handler, then retry';
    expect(scrubLegacyProviderText(t)).toBe(t);
    // Not an old message from the start, so the suffix stays, but a key in it is still redacted.
    expect(scrubLegacyProviderText(`Kept: Invalid API key (${KEY})`)).toBe(
      'Kept: Invalid API key ([redacted])',
    );
  });

  it('redacts a key glued to a URL-encoded "=" and the stored keys verbatim and URL-encoded', () => {
    const gem = ['AIza', 'SyFakeFakeFake012345'].join('');
    expect(leaks(scrubLegacyProviderText(`url?key%3D${gem}&x=1`), gem)).toBe(false);
    const custom = ['my+custom', 'key=value', '1234'].join('/');
    for (const form of [custom, encodeURIComponent(custom)]) {
      const out = scrubLegacyProviderText(`Something broke: ${form} oops`, [custom]);
      expect(leaks(out, custom), out).toBe(false);
      expect(leaks(out, encodeURIComponent(custom)), out).toBe(false);
    }
    expect(scrubLegacyProviderText('short k in text', ['k'])).toBe('short k in text');
  });

  it('is idempotent', () => {
    const once = scrubLegacyProviderText(`Invalid API key (${KEY})`);
    expect(scrubLegacyProviderText(once)).toBe(once);
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
