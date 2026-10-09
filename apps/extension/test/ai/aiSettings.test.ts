import { createOpenAICompat, getPreset, listModels } from '@specimen/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveByokProvider } from '@/lib/aiByok';
import {
  isEncrypted,
  loadAiSettings,
  loadKey,
  removeKey,
  saveAiSettings,
  saveKey,
  secretKey,
  unlockKeys,
} from '@/lib/aiSettings';

const KEY = 'sk-super-secret-key-9999';
const PASS = 'my passphrase';

function fakeArea() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn(async (k?: string | string[] | null) => {
      if (k == null) return { ...data };
      const keys = Array.isArray(k) ? k : [k];
      return Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, data[x]]));
    }),
    set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(data, structuredClone(o))),
    remove: vi.fn(async (k: string) => void delete data[k]),
  };
}

let local: ReturnType<typeof fakeArea>;
let sync: ReturnType<typeof fakeArea>;
let session: ReturnType<typeof fakeArea>;
const consoleCalls: unknown[][] = [];

beforeEach(() => {
  local = fakeArea();
  sync = fakeArea();
  session = fakeArea();
  vi.stubGlobal('chrome', {
    storage: { local, sync, session, onChanged: { addListener() {}, removeListener() {} } },
  });
  consoleCalls.length = 0;
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void consoleCalls.push(a));
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const everywhereKey = (obj: unknown) => JSON.stringify(obj).includes(KEY);
const nothingLoggedKey = () => {
  const text = consoleCalls
    .map((a) =>
      a.map((x) => (x instanceof Error ? `${x.message}${x.stack}` : JSON.stringify(x))).join(' '),
    )
    .join('\n');
  expect(text).not.toContain(KEY);
};

describe('AI key storage', () => {
  it('T3.10 stores keys in storage.local only, never storage.sync', async () => {
    await saveAiSettings({
      provider: 'byok',
      byok: { preset: 'openai', baseUrl: '', model: 'm', keyRef: '' },
    });
    await saveKey('openai', KEY);
    await saveKey('anthropic', KEY, PASS);
    expect(sync.set).not.toHaveBeenCalled();
    expect(Object.keys(sync.data)).toEqual([]);
    expect(local.data[secretKey('openai')]).toEqual({ v: 1, enc: false, key: KEY });
    // Settings never carry the key itself.
    expect(everywhereKey(local.data['settings.ai'])).toBe(false);
    expect(everywhereKey(sync.data)).toBe(false);
    expect(everywhereKey(session.data)).toBe(false);
  });

  it('T3.10 encrypts with a passphrase: ciphertext at rest, round-trip after unlock, wrong passphrase fails', async () => {
    await saveKey('anthropic', KEY, PASS);
    expect(await isEncrypted('anthropic')).toBe(true);
    expect(everywhereKey(local.data)).toBe(false);
    expect(everywhereKey(session.data)).toBe(false); // only the derived key is cached
    expect(JSON.stringify(session.data)).not.toContain(PASS);

    expect(await loadKey('anthropic')).toEqual({ status: 'ok', key: KEY });

    // New browser session: locked until the passphrase is entered.
    for (const k of Object.keys(session.data)) delete session.data[k];
    expect(await loadKey('anthropic')).toEqual({ status: 'locked' });
    expect(await unlockKeys('anthropic', 'wrong')).toBe(false);
    expect(await loadKey('anthropic')).toEqual({ status: 'locked' });
    expect(await unlockKeys('anthropic', PASS)).toBe(true);
    expect(await loadKey('anthropic')).toEqual({ status: 'ok', key: KEY });
  });

  it('T3.10 refuses a passphrase that does not match the other saved keys; remove deletes', async () => {
    await saveKey('anthropic', KEY, PASS);
    for (const k of Object.keys(session.data)) delete session.data[k];
    await expect(saveKey('openai', 'other', 'different')).rejects.toThrow(/does not match/);
    await removeKey('anthropic');
    expect(await loadKey('anthropic')).toEqual({ status: 'none' });
  });

  it('T3.10 no console call ever receives the key (save, load, test and chat flows)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/models')) {
          return new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), { status: 200 });
        }
        if (consoleCalls.length > 1000) throw new Error('unreachable');
        return new Response('{"error":{"message":"bad key"}}', { status: 401 });
      }),
    );
    await saveAiSettings({ provider: 'byok' });
    await saveKey('openai', KEY);
    await saveKey('anthropic', KEY, PASS);
    await loadAiSettings();
    await loadKey('openai');
    await loadKey('anthropic');
    await unlockKeys('anthropic', 'wrong');

    const preset = getPreset('openai');
    if (!preset) throw new Error('preset');
    await listModels(preset, { baseUrl: preset.baseUrl, apiKey: KEY });
    const provider = resolveByokProvider(preset, {
      baseUrl: preset.baseUrl,
      model: 'gpt-4o-mini',
      apiKey: KEY,
      vision: false,
    });
    await provider.status();
    await expect(
      (async () => {
        for await (const _ of provider.chat({ messages: [{ role: 'user', content: 'hi' }] })) {
          /* drain */
        }
      })(),
    ).rejects.toMatchObject({ kind: 'auth' });
    const direct = createOpenAICompat({ baseUrl: 'https://x/v1', model: 'm', apiKey: KEY });
    await direct.status();

    nothingLoggedKey();
  });
});
