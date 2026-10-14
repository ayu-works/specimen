import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_AI } from '../src/lib/aiSettings';
import { _resetCouncilDb, latestRun, putRun } from '../src/lib/councilDb';
import { BADGE, createCouncilGuard, shouldHalt } from '../src/lib/councilGuard';
import { type CouncilRecord, SEEN_KEY } from '../src/lib/councilProtocol';
import { flagKey } from '../src/lib/flags';

const groq = {
  provider: 'byok',
  webllmModel: 'g',
  byok: { preset: 'groq', baseUrl: 'u', model: 'm' },
};

function guard(offscreen = true) {
  const halts: number[] = [];
  const badges: string[] = [];
  const g = createCouncilGuard({
    hasOffscreen: async () => offscreen,
    sendHalt: async (m) => {
      halts.push(m.at);
    },
    setBadge: async (t) => {
      badges.push(t);
    },
    now: () => 4242,
  });
  return { g, halts, badges };
}

beforeEach(async () => {
  await _resetCouncilDb();
});
afterEach(async () => {
  await _resetCouncilDb();
});

describe('council guard (service worker)', () => {
  it('T3.31 the flag switched off halts the run; on does not', () => {
    expect(
      shouldHalt({ [flagKey('critique')]: { oldValue: true, newValue: undefined } }, 'local'),
    ).toBe(true);
    expect(
      shouldHalt({ [flagKey('critique')]: { oldValue: true, newValue: 'true' } }, 'local'),
    ).toBe(true);
    expect(shouldHalt({ [flagKey('critique')]: { newValue: true } }, 'local')).toBe(false);
  });

  it('T3.31 a provider change halts; a change that keeps the same provider does not', () => {
    const change = (newValue: unknown) => ({ [KEY_AI]: { oldValue: groq, newValue } });
    expect(shouldHalt(change({ ...groq, byok: { ...groq.byok, preset: 'openai' } }), 'local')).toBe(
      true,
    );
    expect(shouldHalt(change({ ...groq, byok: { ...groq.byok, model: 'other' } }), 'local')).toBe(
      true,
    );
    expect(shouldHalt(change({ ...groq, provider: 'webllm' }), 'local')).toBe(true);
    // A local model's download list or the encryption choice don't change where data goes.
    expect(shouldHalt(change({ ...groq, downloaded: ['x'], encryptKeys: true }), 'local')).toBe(
      false,
    );
  });

  it('T3.31 any key change halts; locking halts, unlocking does not; other keys never do', () => {
    expect(shouldHalt({ 'secrets.groq': { newValue: { key: 'x' } } }, 'local')).toBe(true);
    expect(shouldHalt({ 'secrets.groq': { oldValue: { key: 'x' } } }, 'local')).toBe(true);
    expect(shouldHalt({ 'session.vaultKey': { oldValue: {} } }, 'session')).toBe(true);
    expect(shouldHalt({ 'session.vaultKey': { newValue: {} } }, 'session')).toBe(false);
    expect(shouldHalt({ 'shortcut.pending': { newValue: 1 } }, 'session')).toBe(false);
    expect(shouldHalt({ [SEEN_KEY]: { newValue: 'r' } }, 'local')).toBe(false);
    expect(shouldHalt({ 'secrets.groq': { newValue: 1 } }, 'sync')).toBe(false);
  });

  it('T3.31 the guard sends halt{at} with the change time, only when an offscreen document exists', async () => {
    const { g, halts } = guard(true);
    await g.onStorageChanged({ 'secrets.groq': { newValue: {} } }, 'local');
    expect(halts).toEqual([4242]);
    await g.onStorageChanged({ [SEEN_KEY]: { newValue: 'r' } }, 'local');
    expect(halts).toHaveLength(1);
    const none = guard(false);
    await none.g.onStorageChanged({ 'secrets.groq': { newValue: {} } }, 'local');
    expect(none.halts).toEqual([]);
  });

  it('T3.31 badge: cleared when a run starts, ✓ on done, ! on error, none on stop, cleared when seen', async () => {
    const { g, badges } = guard();
    await g.onRuntime({ type: 'council.started', runId: 'r' });
    await g.onRuntime({ type: 'council.finished', runId: 'r', status: 'done' });
    await g.onRuntime({ type: 'council.finished', runId: 'r', status: 'error' });
    await g.onRuntime({ type: 'council.finished', runId: 'r', status: 'stopped' });
    await g.onStorageChanged({ [SEEN_KEY]: { newValue: 'r' } }, 'local');
    expect(badges).toEqual(['', BADGE.done, BADGE.problem, '', '']);
  });

  it('T3.32 browser start / install marks running records interrupted and shows !', async () => {
    const rec: CouncilRecord = {
      v: 1,
      runId: 'live',
      scanId: 's',
      scanHost: 'example.com',
      status: 'running',
      plan: { personas: ['brand', 'a11y'], rounds: 1, totalTurns: 3, providerLabel: 'Groq' },
      context: '',
      turns: [{ kind: 'persona', persona: 'brand', content: 'a', status: 'done' }],
      verdict: null,
      startedAt: 1,
      updatedAt: 1,
    };
    await putRun(rec);
    const { g, badges } = guard();
    await g.onStartup();
    const after = await latestRun();
    expect(after?.status).toBe('interrupted');
    expect(after?.turns).toHaveLength(1);
    expect(badges).toEqual([BADGE.problem]);
    // Nothing running: no badge.
    const again = guard();
    await again.g.onStartup();
    expect(again.badges).toEqual([]);
  });

  it('T3.31 a badge API failure is swallowed', async () => {
    const g = createCouncilGuard({
      hasOffscreen: async () => true,
      sendHalt: vi.fn(async () => {
        throw new Error('no receiver');
      }),
      setBadge: async () => {
        throw new Error('nope');
      },
    });
    await expect(
      g.onRuntime({ type: 'council.finished', runId: 'r', status: 'done' }),
    ).resolves.toBeUndefined();
    await expect(
      g.onStorageChanged({ 'secrets.x': { newValue: 1 } }, 'local'),
    ).resolves.toBeUndefined();
  });
});
