import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import {
  _resetChatScrub,
  redactKnownKeys,
  SCRUB_MARKER,
  scrubStoredChats,
  startChatScrub,
} from '../src/lib/chatScrub';
import { type ChatMessage, db, loadChat, saveScan } from '../src/lib/db';
import { type FakeChrome, installChrome } from './helpers/chrome';

// Fake keys only. The Anthropic-shaped one is a known key; the custom one has no recognisable shape.
const KEY = ['sk', 'ant', 'api03', 'FAKEFAKEFAKEFAKEFAKEFAKE', '0123456789abcdef'].join('-');
const CUSTOM = 'zz9-plural-z-alpha';
const HEX40 = 'a3f9c2e17b4d8a0f6e5c3b2a19d8e7f6a5b4c3d2';
const LOOKALIKE = ['sk', 'not', 'a', 'real', 'key', 'just', 'text', '1234567890abcdefghij'].join(
  '-',
);

let chrome: FakeChrome;

const rowOf = (scanId: string, messages: ChatMessage[]) => db.chats.put({ scanId, messages });
const storePlainKey = (preset: string, key: string) =>
  chrome.storage.local.data.set(`secrets.${preset}`, { v: 1, enc: false, key });

beforeEach(async () => {
  chrome = installChrome();
  _resetChatScrub();
  await Promise.all([db.scans.clear(), db.chats.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('T4.11 one-time scrub of stored Ask history', () => {
  it('T4.11 removes known keys from errors and answers, keeps user text and real answers, sets the marker', async () => {
    storePlainKey('anthropic', KEY);
    storePlainKey('custom', CUSTOM);
    await rowOf('s1', [
      { role: 'user', content: `my key is ${KEY}, why?` },
      { role: 'assistant', content: '', error: `Invalid API key (${KEY})` },
      {
        role: 'assistant',
        content: `The commit ${HEX40} uses ${LOOKALIKE}; token ${CUSTOM} and ${encodeURIComponent(KEY)}.`,
      },
    ]);
    await rowOf('s2', [{ role: 'assistant', content: 'Use #5e6ad2 for links.' }]);

    expect(await scrubStoredChats()).toBe('done');

    const s1 = (await db.chats.get('s1'))?.messages ?? [];
    expect(s1[0]?.content).toBe(`my key is ${KEY}, why?`);
    expect(s1[1]?.error).not.toContain('FAKEFAKE');
    expect(s1[2]?.content).toBe(
      `The commit ${HEX40} uses ${LOOKALIKE}; token [redacted] and [redacted].`,
    );
    expect((await db.chats.get('s2'))?.messages[0]?.content).toBe('Use #5e6ad2 for links.');
    expect(chrome.storage.local.data.get(SCRUB_MARKER)).toBe(1);
  });

  it('T4.11 scrubs key shapes in error text even with no stored key', async () => {
    await rowOf('s1', [{ role: 'assistant', content: '', error: `Something broke: ${KEY}` }]);
    expect(await scrubStoredChats()).toBe('done');
    expect((await db.chats.get('s1'))?.messages[0]?.error).not.toContain('FAKEFAKE');
  });

  it('T4.11 runs once: with the marker set it reads nothing and writes nothing', async () => {
    storePlainKey('anthropic', KEY);
    await rowOf('s1', [{ role: 'assistant', content: `x ${KEY}` }]);
    expect(await scrubStoredChats()).toBe('done');
    const after = await db.chats.get('s1');
    const put = vi.spyOn(db.chats, 'put');
    chrome.storage.local.get.mockClear();
    expect(await scrubStoredChats()).toBe('skipped');
    expect(put).not.toHaveBeenCalled();
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1); // the marker only, no keys
    expect(await db.chats.get('s1')).toEqual(after);
  });

  it('T4.11 a second scrub of already-clean rows changes nothing (idempotent)', async () => {
    storePlainKey('anthropic', KEY);
    await rowOf('s1', [
      { role: 'assistant', content: `x ${KEY}`, error: `Invalid API key (${KEY})` },
    ]);
    await scrubStoredChats();
    const once = await db.chats.get('s1');
    chrome.storage.local.data.delete(SCRUB_MARKER);
    expect(await scrubStoredChats()).toBe('done');
    expect(await db.chats.get('s1')).toEqual(once);
  });

  it('T4.11 a write failing halfway leaves every row unchanged and no marker; a retry then succeeds', async () => {
    storePlainKey('anthropic', KEY);
    const rows: [string, ChatMessage[]][] = [
      ['a', [{ role: 'assistant', content: `one ${KEY}` }]],
      ['b', [{ role: 'assistant', content: `two ${KEY}` }]],
      ['c', [{ role: 'assistant', content: `three ${KEY}` }]],
    ];
    for (const [id, m] of rows) await rowOf(id, m);
    const realPut = db.chats.put.bind(db.chats);
    let n = 0;
    const put = vi.spyOn(db.chats, 'put').mockImplementation((...args) => {
      n += 1;
      if (n === 2) throw new Error('quota');
      return realPut(...args);
    });
    const log = vi.spyOn(console, 'error');

    expect(await scrubStoredChats()).toBe('failed');
    for (const [id, m] of rows) expect((await db.chats.get(id))?.messages).toEqual(m);
    expect(chrome.storage.local.data.has(SCRUB_MARKER)).toBe(false);
    expect(log).not.toHaveBeenCalled();

    put.mockRestore();
    expect(await scrubStoredChats()).toBe('done');
    for (const [id] of rows) expect(JSON.stringify(await db.chats.get(id))).not.toContain(KEY);
    expect(chrome.storage.local.data.get(SCRUB_MARKER)).toBe(1);
  });

  it('T4.11 a locked (encrypted) key: shape scrub runs, the marker waits for a run with every key', async () => {
    chrome.storage.local.data.set('secrets.openai', {
      v: 1,
      enc: true,
      salt: 's',
      iv: 'i',
      data: 'd',
    });
    await rowOf('s1', [{ role: 'assistant', content: '', error: `Invalid API key (${KEY})` }]);
    expect(await scrubStoredChats()).toBe('partial');
    expect((await db.chats.get('s1'))?.messages[0]?.error).not.toContain('FAKEFAKE');
    expect(chrome.storage.local.data.has(SCRUB_MARKER)).toBe(false);
  });

  it('T4.11 never logs a key, and holds chat reads until it has finished', async () => {
    storePlainKey('anthropic', KEY);
    await saveScan({ ...sampleScan, id: 's1' }, null);
    await rowOf('s1', [{ role: 'assistant', content: `x ${KEY}` }]);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m),
    );
    const scrub = scrubStoredChats();
    const read = loadChat('s1'); // started while the scrub runs: must see the scrubbed row
    await scrub;
    expect(JSON.stringify(await read)).not.toContain(KEY);
    for (const s of spies) for (const call of s.mock.calls) expect(String(call)).not.toContain(KEY);
  });

  it('T4.11 the panel runs one scrub per open, and a chat read started right after waits for it', async () => {
    storePlainKey('anthropic', KEY);
    await saveScan({ ...sampleScan, id: 's1' }, null);
    await rowOf('s1', [{ role: 'assistant', content: `x ${KEY}` }]);
    const first = startChatScrub(); // as main.tsx does at module load
    const read = loadChat('s1'); // as a view's mount effect would, before App's restore
    expect(startChatScrub()).toBe(first); // restorePanel awaits the same run
    expect(await first).toBe('done');
    expect(JSON.stringify(await read)).not.toContain(KEY);
  });

  it('T4.11 a malformed row is skipped, the others are scrubbed and the marker is set', async () => {
    storePlainKey('anthropic', KEY);
    await db.chats.put({ scanId: 'bad', messages: 'not an array' as unknown as ChatMessage[] });
    await rowOf('good', [{ role: 'assistant', content: `x ${KEY}` }]);
    expect(await scrubStoredChats()).toBe('done');
    expect(JSON.stringify(await db.chats.get('good'))).not.toContain(KEY);
    expect((await db.chats.get('bad'))?.messages).toBe('not an array');
    expect(chrome.storage.local.data.get(SCRUB_MARKER)).toBe(1);
  });

  it('T4.11 redactKnownKeys ignores keys shorter than 8 characters', () => {
    expect(redactKnownKeys('short k in text', ['k'])).toBe('short k in text');
    expect(redactKnownKeys(`a ${CUSTOM} b`, [CUSTOM])).toBe('a [redacted] b');
  });
});
