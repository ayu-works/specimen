import 'fake-indexeddb/auto';
import { ProviderError } from '@specimen/ai';
import { createMockProvider } from '@specimen/ai/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCouncilHost, type HostDeps } from '../src/entrypoints/offscreen/councilHost';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import {
  _resetCouncilDb,
  countRuns,
  interruptAllRunning,
  KEEP_RUNS,
  latestRun,
  markInterrupted,
  putRun,
} from '../src/lib/councilDb';
import {
  COUNCIL_REJECT,
  COUNCIL_V,
  type CouncilRecord,
  type CouncilRuntimeMsg,
  type HostMsg,
  type ProviderSpec,
} from '../src/lib/councilProtocol';

const FAKE_KEY = 'sk-test-FAKEFAKEFAKEFAKEFAKE0123456789';
const SPEC: ProviderSpec = {
  kind: 'byok',
  cfg: {
    preset: 'groq',
    baseUrl: 'https://example.invalid/v1',
    model: 'm',
    apiKey: FAKE_KEY,
    vision: false,
  },
};
const VERDICT =
  'Verdict: Calm and tidy.\nWorks:\n- Accent #5e6ad2\nChange:\n- Muted text to 4.5:1\nDisagreed:\n- None';

function mock(opts: Parameters<typeof createMockProvider>[0] = {}) {
  let n = 0;
  return createMockProvider({
    respond: (req) =>
      String(req.messages[0]?.content).includes('Write the verdict')
        ? VERDICT
        : `turn ${++n} at 16px.`,
    ...opts,
  });
}

/** A Chrome-like Port: posting after disconnect throws, as Chrome does. */
function fakePort() {
  const msgs = new Set<(m: unknown) => void>();
  const discs = new Set<() => void>();
  const got: HostMsg[] = [];
  let open = true;
  return {
    got,
    postMessage: vi.fn((m: HostMsg) => {
      if (!open) throw new Error('Attempting to use a disconnected port object');
      got.push(structuredClone(m));
    }),
    onMessage: { addListener: (cb: (m: unknown) => void) => msgs.add(cb) },
    onDisconnect: { addListener: (cb: () => void) => discs.add(cb) },
    send(m: unknown) {
      for (const cb of msgs) cb(m);
    },
    /** The panel closed. `silent` = the host doesn't hear it (the post must still not break). */
    close(silent = false) {
      open = false;
      if (!silent) for (const cb of discs) cb();
    },
  };
}

function setup(provider = mock(), extra: Partial<HostDeps> = {}) {
  const notified: CouncilRuntimeMsg[] = [];
  const host = createCouncilHost({
    makeProvider: async () => provider,
    notify: (m) => notified.push(m),
    engine: { retryDelaysMs: [5, 5, 5], tokensPerMinute: 0 },
    ...extra,
  });
  return { host, provider, notified };
}

const start = (runId = 'run-1', over: Record<string, unknown> = {}) => ({
  type: 'start',
  v: COUNCIL_V,
  runId,
  scan: sampleScan,
  provider: SPEC,
  personas: ['brand', 'a11y', 'frontend'],
  rounds: 2,
  context: 'A clinic booking app for older patients.',
  ...over,
});

async function finished(notified: CouncilRuntimeMsg[], runId = 'run-1') {
  await vi.waitFor(
    () =>
      expect(notified.some((m) => m.type === 'council.finished' && m.runId === runId)).toBe(true),
    { timeout: 10_000 },
  );
}

beforeEach(async () => {
  await _resetCouncilDb();
});
afterEach(async () => {
  await _resetCouncilDb();
});

describe('council host (offscreen)', () => {
  it('T3.30 a run goes running → turns → done with a verdict, stored once per turn end', async () => {
    const putSpy = vi.fn(putRun);
    const { host, provider, notified } = setup(mock(), { put: putSpy });
    const port = fakePort();
    host.attach(port);
    port.send(start());
    await finished(notified);
    expect(provider.calls).toHaveLength(7);
    const rec = (await latestRun()) as CouncilRecord;
    expect(rec.status).toBe('done');
    expect(rec.verdict?.works).toEqual(['Accent #5e6ad2']);
    expect(rec.context).toBe('A clinic booking app for older patients.');
    expect(rec.plan).toMatchObject({ totalTurns: 7, providerLabel: 'Mock AI' });
    // 1 at start + 7 turn ends + 1 final.
    expect(putSpy).toHaveBeenCalledTimes(9);
    expect(port.got[0]).toMatchObject({ type: 'snapshot' });
    expect(port.got.at(-1)).toMatchObject({ type: 'status', status: 'done' });
    expect(notified).toEqual([
      { type: 'council.started', runId: 'run-1' },
      { type: 'council.finished', runId: 'run-1', status: 'done' },
    ]);
    expect(host.liveRunId).toBeNull();
  });

  it('T3.30 the panel closing mid-run (posts throw after disconnect) never breaks the run', async () => {
    for (const silent of [false, true]) {
      await _resetCouncilDb();
      const { host, provider, notified } = setup(mock({ delayMs: 10, chunkSize: 2 }));
      const port = fakePort();
      host.attach(port);
      port.send(start());
      await vi.waitFor(() => expect(provider.calls.length).toBeGreaterThanOrEqual(2));
      port.close(silent);
      await finished(notified);
      expect(provider.calls).toHaveLength(7);
      expect((await latestRun())?.status).toBe('done');
    }
  });

  it('T3.30 a second panel attaches mid-run and gets the live snapshot, then deltas', async () => {
    const { host, provider, notified } = setup(mock({ delayMs: 10, chunkSize: 2 }));
    const a = fakePort();
    host.attach(a);
    a.send(start());
    await vi.waitFor(() => expect(provider.calls.length).toBeGreaterThanOrEqual(2));
    const b = fakePort();
    host.attach(b);
    b.send({ type: 'attach' });
    expect(b.got[0]).toMatchObject({
      type: 'snapshot',
      record: { runId: 'run-1', status: 'running' },
    });
    await finished(notified);
    expect(b.got.some((m) => m.type === 'turn')).toBe(true);
    expect(b.got.at(-1)).toMatchObject({ type: 'status', status: 'done' });
  });

  it('T3.30 one run per extension: a second start gets the live run, no second run', async () => {
    const { host, provider, notified } = setup(mock({ delayMs: 10, chunkSize: 2 }));
    const a = fakePort();
    const b = fakePort();
    host.attach(a);
    host.attach(b);
    a.send(start('run-1'));
    await vi.waitFor(() => expect(provider.calls.length).toBeGreaterThanOrEqual(1));
    b.send(start('run-2'));
    await vi.waitFor(() =>
      expect(b.got.some((m) => m.type === 'snapshot' && m.record?.runId === 'run-1')).toBe(true),
    );
    await finished(notified);
    expect(provider.calls).toHaveLength(7);
    expect(notified.filter((m) => m.type === 'council.started')).toHaveLength(1);
  });

  it('T3.30 attach with no live run answers an empty snapshot', () => {
    const { host } = setup();
    const p = fakePort();
    host.attach(p);
    p.send({ type: 'attach' });
    expect(p.got).toEqual([{ type: 'snapshot', record: null }]);
  });

  it('T3.30 the store keeps exactly the newest 5 runs', async () => {
    const base = (await (async () => {
      const { host, notified } = setup();
      const p = fakePort();
      host.attach(p);
      p.send(start('seed'));
      await finished(notified, 'seed');
      return latestRun();
    })()) as CouncilRecord;
    for (let i = 0; i < 8; i++) await putRun({ ...base, runId: `r${i}`, startedAt: 1000 + i });
    expect(await countRuns()).toBe(KEEP_RUNS);
    expect((await latestRun())?.runId).toBe('seed');
  });

  it('T3.31 stop{runId} stops the live run; a stop for another run does nothing', async () => {
    const { host, provider, notified } = setup(mock({ delayMs: 5, chunkSize: 2 }));
    const p = fakePort();
    host.attach(p);
    p.send(start());
    await vi.waitFor(() => expect(provider.calls.length).toBeGreaterThanOrEqual(2));
    p.send({ type: 'stop', runId: 'someone-else' });
    await new Promise((r) => setTimeout(r, 20));
    expect(host.liveRunId).toBe('run-1');
    p.send({ type: 'stop', runId: 'run-1' });
    await finished(notified);
    const calls = provider.calls.length;
    expect(calls).toBeLessThan(7);
    expect((await latestRun())?.status).toBe('stopped');
    expect(
      provider.calls.some((c) => String(c.messages[0]?.content).includes('Write the verdict')),
    ).toBe(false);
  });

  it('T3.31 the SW halt stops a run with no panel attached, and stops a run during a retry wait', async () => {
    const { host, provider, notified } = setup(mock({ delayMs: 5, chunkSize: 2 }));
    const p = fakePort();
    host.attach(p);
    p.send(start());
    await vi.waitFor(() => expect(provider.calls.length).toBeGreaterThanOrEqual(2));
    p.close();
    host.halt(Date.now());
    await finished(notified);
    expect((await latestRun())?.status).toBe('stopped');
    const n = provider.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(provider.calls.length).toBe(n);

    // During a rate-limit wait.
    await _resetCouncilDb();
    const rate = createMockProvider({ error: new ProviderError('rate', 'slow down') });
    const s2 = setup(rate, { engine: { retryDelaysMs: [60_000], tokensPerMinute: 0 } });
    const p2 = fakePort();
    s2.host.attach(p2);
    p2.send(start('run-2'));
    await vi.waitFor(() =>
      expect(p2.got.some((m) => m.type === 'turn' && m.turn.status === 'retrying')).toBe(true),
    );
    s2.host.halt(Date.now());
    await finished(s2.notified, 'run-2');
    expect(rate.calls).toHaveLength(1);
    expect((await latestRun())?.status).toBe('stopped');
  });

  it('T3.31 halt{at} is ignored by a run that started after the change (both orders)', async () => {
    let t = 1000;
    const { host, provider, notified } = setup(mock({ delayMs: 10, chunkSize: 2 }), {
      now: () => t,
    });
    const p = fakePort();
    host.attach(p);
    // The key changed at 999, then the user started a run at 1000: the run already uses the new key.
    p.send(start());
    await vi.waitFor(() => expect(provider.calls.length).toBeGreaterThanOrEqual(1));
    host.halt(999);
    // Started at 1000, the change at 1000 or later stops it.
    expect(host.liveRunId).toBe('run-1');
    t = 2000;
    host.halt(1500);
    await finished(notified);
    expect((await latestRun())?.status).toBe('stopped');
  });

  it('T3.32 a provider error ends the run with fixed text and no verdict', async () => {
    const p = createMockProvider({
      error: new ProviderError('network', `failed: ${FAKE_KEY}`),
      errorAfter: 0,
    });
    const { host, notified } = setup(p);
    const port = fakePort();
    host.attach(port);
    port.send(start());
    await finished(notified);
    const rec = (await latestRun()) as CouncilRecord;
    expect(rec.status).toBe('error');
    expect(rec.error).toBe("Can't reach the provider. Check your connection and try again.");
    expect(rec.verdict).toBeNull();
    expect(p.calls).toHaveLength(1);
  });

  it('T3.32 bad starts are rejected with fixed text: nothing stored, nothing called', async () => {
    const cases: [unknown, string | null, string][] = [
      ['nope', null, COUNCIL_REJECT.malformed],
      [{ type: 'start', v: COUNCIL_V }, null, COUNCIL_REJECT.malformed],
      [start('r-v', { v: 2 }), 'r-v', COUNCIL_REJECT.version],
      [start('r-p', { personas: ['ceo'] }), 'r-p', COUNCIL_REJECT.malformed],
      [start('r-r', { rounds: 9 }), 'r-r', COUNCIL_REJECT.malformed],
      [start('r-s', { provider: { kind: 'byok', cfg: {} } }), 'r-s', COUNCIL_REJECT.malformed],
    ];
    const { host, provider, notified } = setup();
    for (const [msg, runId, error] of cases) {
      const p = fakePort();
      host.attach(p);
      expect(() => p.send(msg)).not.toThrow();
      expect(p.got).toEqual([{ type: 'rejected', runId, error }]);
    }
    // A provider that can't run here (Chrome built-in missing, unknown preset).
    const none = createCouncilHost({
      makeProvider: async () => null,
      notify: (m) => notified.push(m),
    });
    const p = fakePort();
    none.attach(p);
    p.send(start('r-c', { provider: { kind: 'chrome' } }));
    await vi.waitFor(() =>
      expect(p.got).toEqual([{ type: 'rejected', runId: 'r-c', error: COUNCIL_REJECT.provider }]),
    );
    const throwing = createCouncilHost({
      makeProvider: async () => {
        throw new Error(FAKE_KEY);
      },
      notify: (m) => notified.push(m),
    });
    const q = fakePort();
    throwing.attach(q);
    q.send(start('r-t'));
    await vi.waitFor(() => expect(q.got[0]).toMatchObject({ type: 'rejected', runId: 'r-t' }));
    expect(provider.calls).toHaveLength(0);
    expect(await countRuns()).toBe(0);
    expect(notified).toHaveLength(0);
  });

  it('T3.32 the key never leaves the host: not in any message, record or SW notice', async () => {
    const leaky = mock({ delayMs: 1, chunkSize: 4 });
    const { host, notified } = setup(leaky);
    const p = fakePort();
    host.attach(p);
    p.send(start());
    await finished(notified);
    // And an error path that carries the key in the provider's message.
    await vi.waitFor(() => expect(host.liveRunId).toBeNull());
    const bad = createCouncilHost({
      makeProvider: async () =>
        createMockProvider({ error: new ProviderError('auth', `bad key ${FAKE_KEY}`) }),
      notify: (m) => notified.push(m),
    });
    bad.attach(p);
    p.send(start('run-2'));
    await finished(notified, 'run-2');
    const stored = JSON.stringify(await Promise.all([latestRun(), countRuns()]));
    const everything = JSON.stringify(p.got) + JSON.stringify(notified) + stored;
    expect(everything).not.toContain(FAKE_KEY);
    expect(everything).not.toContain('FAKEFAKE');
  });

  it('T3.32 a failing store never breaks the run; the final write is retried once', async () => {
    const put = vi.fn(async () => {
      throw new Error('quota');
    });
    const { host, provider, notified } = setup(mock(), { put });
    const p = fakePort();
    host.attach(p);
    p.send(start());
    await finished(notified);
    expect(provider.calls).toHaveLength(7);
    expect(p.got.at(-1)).toMatchObject({ type: 'status', status: 'done' });
    // 1 start + 7 turn ends + final + its retry.
    expect(put).toHaveBeenCalledTimes(10);
  });

  it('T3.32 markInterrupted is conditional, and interruptAllRunning catches every running record', async () => {
    const { host, notified } = setup();
    const p = fakePort();
    host.attach(p);
    p.send(start('seed'));
    await finished(notified, 'seed');
    const base = (await latestRun()) as CouncilRecord;
    await putRun({ ...base, runId: 'a', status: 'running', startedAt: 10, updatedAt: 5 });
    await putRun({ ...base, runId: 'b', status: 'running', startedAt: 11, updatedAt: 5 });
    // The host wrote a turn after we looked (updatedAt moved): no overwrite.
    expect(await markInterrupted('a', 4)).toBeNull();
    expect((await markInterrupted('a', 5))?.status).toBe('interrupted');
    expect(await markInterrupted('a', 5)).toBeNull();
    expect(await interruptAllRunning()).toBe(1);
    expect(await interruptAllRunning()).toBe(0);
  });
});
