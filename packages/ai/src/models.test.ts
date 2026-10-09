import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactScan } from './features/pageData';
import { listModels, pickModel } from './models';
import { getPreset } from './presets';
import { loadFixtureScan } from './testing/testUtils';

afterEach(() => vi.unstubAllGlobals());

function stubJson(body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', f);
  return f;
}
const preset = (id: string) => {
  const p = getPreset(id);
  if (!p) throw new Error(id);
  return p;
};

const GROQ = [
  'allam-2-7b',
  'canopylabs/orpheus-arabic-saudi',
  'canopylabs/orpheus-v1-english',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
];

describe('listModels', () => {
  it('parses the OpenAI-compatible shape, filters non-chat models and ranks general chat first', async () => {
    const f = stubJson({
      data: [
        { id: 'whisper-large-v3' },
        { id: 'text-embedding-3-small' },
        { id: 'qwen/qwen3.8-27b' },
        { id: 'openai/gpt-oss-20b' },
        { id: 'meta-llama/llama-guard-4-12b' },
        { id: 'openai/gpt-oss-20b' },
      ],
    });
    const ids = await listModels(preset('groq'), {
      baseUrl: 'https://api.groq.com/openai/v1/',
      apiKey: 'k',
    });
    expect(ids).toEqual(['openai/gpt-oss-20b', 'qwen/qwen3.8-27b']);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('drops speech and niche models from the Groq list', async () => {
    stubJson({ data: GROQ.map((id) => ({ id })) });
    const ids = await listModels(preset('groq'), { baseUrl: preset('groq').baseUrl, apiKey: 'k' });
    expect(ids).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']);
  });

  it('parses the Anthropic shape with its headers', async () => {
    const f = stubJson({ data: [{ id: 'claude-b' }, { id: 'claude-a' }] });
    const ids = await listModels(preset('anthropic'), { baseUrl: '', apiKey: 'sk-ant' });
    expect(ids).toEqual(['claude-a', 'claude-b']);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    const h = init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-ant');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('parses the Gemini shape, keeps generateContent models, and keeps the key out of the URL', async () => {
    const f = stubJson({
      models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/aqa', supportedGenerationMethods: ['generateAnswer'] },
      ],
    });
    const ids = await listModels(preset('gemini'), { baseUrl: '', apiKey: 'AIza-x' });
    expect(ids).toEqual(['gemini-2.5-flash']);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('AIza-x');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-x');
  });

  it('maps a 401 to an auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"message":"bad"}}', { status: 401 })),
    );
    await expect(
      listModels(preset('openai'), { baseUrl: 'https://x/v1', apiKey: 'k' }),
    ).rejects.toMatchObject({
      kind: 'auth',
    });
  });
});

describe('pickModel', () => {
  it('prefers the preset default when offered', () => {
    expect(pickModel(GROQ, 'openai/gpt-oss-20b')).toBe('openai/gpt-oss-20b');
  });

  it('falls back to gpt-oss-120b, never allam or orpheus', () => {
    expect(pickModel(GROQ, 'llama-3.3-70b-versatile')).toBe('openai/gpt-oss-120b');
    expect(pickModel(GROQ)).toBe('openai/gpt-oss-120b');
    expect(pickModel(['allam-2-7b', 'qwen/qwen3.8-27b'])).toBe('qwen/qwen3.8-27b');
    const pick = pickModel(GROQ.filter((m) => !m.includes('gpt-oss')));
    expect(pick).toBe('qwen/qwen3.8-27b');
  });

  it('ranks general families and otherwise takes the first; empty list gives undefined', () => {
    expect(pickModel(['zeta', 'mistral-large', 'llama-3.1-8b'])).toBe('llama-3.1-8b');
    expect(pickModel(['b-model', 'a-model'])).toBe('a-model');
    expect(pickModel([])).toBeUndefined();
  });

  it('the Groq preset default is a current model', () => {
    expect(preset('groq').model).toBe('openai/gpt-oss-20b');
  });
});

describe('compactScan', () => {
  it('lists every role as a literal hex (no token ids) using the Stripe capture', () => {
    const scan = loadFixtureScan('real:stripe');
    const out = compactScan(scan);
    const data = JSON.parse(out) as { colorRoles: Record<string, string>; palette: string[] };
    const roles = Object.entries(scan.colors.roles);
    expect(roles.length).toBeGreaterThan(0);
    for (const [role, id] of roles) {
      const hex = scan.colors.palette.find((c) => c.id === id)?.hex;
      expect(hex).toBeDefined();
      expect(out).toContain(`"${role}":"${hex}"`);
      expect(data.colorRoles[role]).toBe(hex);
    }
    for (const id of Object.values(scan.colors.roles)) expect(out).not.toContain(`"${id}"`);
    expect(data.palette.every((h) => /^#[0-9a-f]{3,8}$/i.test(h))).toBe(true);
  });
});
