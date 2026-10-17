import type { LlmEvent, LlmRequest } from '@specimen/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fake WebLLM engine. Like the real one, `interruptGenerate()` ends whichever stream is running
 * with `finish_reason: 'abort'`, and one generation runs at a time. Each `create()` takes the next
 * entry of `state.calls` (default: three tokens, one every 10 ms).
 */
type Call = { tokens?: string[]; manual?: boolean; throwAt?: number; endAbort?: boolean };
type Stream = { interrupted: boolean; wake: () => void };

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  creates: [] as string[],
  current: null as null | Stream,
  loseInterrupts: 0,
  interruptThrows: false,
  loadGate: null as null | Promise<void>,
  failCreate: undefined as undefined | Error,
  failDelete: undefined as undefined | Error,
  interrupts: 0,
  /** The last fake Worker created: tests fire its `error` to simulate a crash. */
  worker: null as null | { fire: (type: string) => void },
}));

vi.mock('@mlc-ai/web-llm', () => {
  async function* gen(call: Call) {
    const h: Stream = { interrupted: false, wake: () => {} };
    state.current = h;
    const tokens = call.tokens ?? ['a', 'b', 'c'];
    try {
      for (let i = 0; i < tokens.length; i++) {
        await new Promise<void>((r) => {
          h.wake = r;
          if (!call.manual) setTimeout(r, 10);
        });
        if (h.interrupted) {
          yield { choices: [{ delta: {}, finish_reason: 'abort' }] };
          return;
        }
        if (call.throwAt === i) throw new Error('decode failed');
        yield { choices: [{ delta: { content: tokens[i] }, finish_reason: null }] };
      }
      yield { choices: [{ delta: {}, finish_reason: call.endAbort ? 'abort' : 'stop' }] };
    } finally {
      if (state.current === h) state.current = null;
    }
  }
  const engine = {
    interruptGenerate: () => {
      state.interrupts++;
      if (state.interruptThrows) throw new Error('worker gone');
      if (state.loseInterrupts > 0) {
        state.loseInterrupts--;
        return;
      }
      const h = state.current;
      if (h) {
        h.interrupted = true;
        h.wake();
      }
    },
    unload: async () => {},
    chat: {
      completions: {
        create: async (body: { messages: { content: string }[] }) => {
          state.creates.push(body.messages.at(-1)?.content ?? '');
          return gen(state.calls.shift() ?? {});
        },
      },
    },
  };
  return {
    CreateWebWorkerMLCEngine: async (
      _w: unknown,
      _id: string,
      opts: { initProgressCallback: (r: { progress: number; text: string }) => void },
    ) => {
      if (state.failCreate) throw state.failCreate;
      opts.initProgressCallback({ progress: 0.5, text: 'half' });
      if (state.loadGate) await state.loadGate;
      opts.initProgressCallback({ progress: 1, text: 'done' });
      return engine;
    },
    hasModelInCache: async () => true,
    deleteModelAllInfoInCache: async () => {
      if (state.failDelete) throw state.failDelete;
    },
  };
});
vi.mock('@/lib/webllmConfig', () => ({ buildAppConfig: () => ({ model_list: [] }) }));

import { DEFAULT_GEMMA, GEMMA_MODELS } from '@/lib/gemmaModels';
import { createPortPair } from '@/lib/localPort';

type Host = typeof import('../../src/entrypoints/offscreen/llmHost');
let host: Host;
let connect: (port: unknown) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The client's view of a Port, as seen by the host. Like Chrome: `disconnect()` fires only the
 * other end's (the host's) onDisconnect, and the host's posts throw afterwards.
 */
function makePort(senderUrl = 'chrome-extension://specimen/sidepanel.html') {
  const events: LlmEvent[] = [];
  const onMsg = new Set<(m: LlmRequest) => void>();
  const onDisc = new Set<() => void>();
  let open = true;
  const port = {
    name: 'llm',
    sender: { url: senderUrl },
    postMessage: (e: LlmEvent) => {
      if (!open) throw new Error('Attempting to use a disconnected port object');
      events.push(e);
    },
    onMessage: { addListener: (cb: (m: LlmRequest) => void) => onMsg.add(cb) },
    onDisconnect: { addListener: (cb: () => void) => onDisc.add(cb) },
  };
  return {
    port,
    events,
    send: (m: LlmRequest) => {
      for (const cb of onMsg) cb(m);
    },
    disconnect: () => {
      open = false;
      for (const cb of onDisc) cb();
    },
    of: (id: string) => events.filter((e) => 'id' in e && e.id === id),
    waitFor: (pred: (e: LlmEvent) => boolean) => waitFor(events, pred),
  };
}
type FakePort = ReturnType<typeof makePort>;

async function waitFor(events: LlmEvent[], pred: (e: LlmEvent) => boolean) {
  for (let i = 0; i < 300; i++) {
    const hit = events.find(pred);
    if (hit) return hit;
    await sleep(5);
  }
  throw new Error(`timed out; got ${JSON.stringify(events)}`);
}

const ended = (id: string) => (e: LlmEvent) =>
  (e.type === 'done' || e.type === 'error') && 'id' in e && e.id === id;
const req = (text: string) => ({ messages: [{ role: 'user' as const, content: text }] });

function open(senderUrl?: string): FakePort {
  const c = makePort(senderUrl);
  connect(c.port);
  return c;
}
async function loaded(): Promise<FakePort> {
  const c = open();
  c.send({ type: 'load', modelId: DEFAULT_GEMMA });
  await c.waitFor((e) => e.type === 'ready');
  return c;
}
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  Object.assign(state, {
    calls: [],
    creates: [],
    current: null,
    loseInterrupts: 0,
    interruptThrows: false,
    loadGate: null,
    failCreate: undefined,
    failDelete: undefined,
    interrupts: 0,
    worker: null,
  });
  vi.stubGlobal(
    'Worker',
    // Like the real one, terminate() settles nothing: a stream in flight stays pending for ever.
    class {
      private ls = new Map<string, Set<() => void>>();
      constructor() {
        state.worker = {
          fire: (t) => {
            for (const cb of this.ls.get(t) ?? []) cb();
          },
        };
      }
      addEventListener(t: string, cb: () => void) {
        if (!this.ls.has(t)) this.ls.set(t, new Set());
        this.ls.get(t)?.add(cb);
      }
      terminate() {}
    },
  );
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (p: string) => `chrome-extension://specimen/${p}`,
      onConnect: { addListener: (cb: (p: unknown) => void) => (connect = cb) },
    },
  });
  // A fresh host per test: its engine, ports and queue are module state.
  vi.resetModules();
  host = await import('../../src/entrypoints/offscreen/llmHost');
  host.startLlmHost();
});

describe('llm Port protocol (host)', () => {
  it('T3.11 load emits progress then ready; status then reports the loaded model', async () => {
    const c = open();
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await c.waitFor((e) => e.type === 'ready');
    const types = c.events.map((e) => e.type);
    expect(types.slice(0, 3)).toEqual(['progress', 'progress', 'ready']);
    expect(host.llmBusy()).toBe(true);
    c.send({ type: 'status', modelId: DEFAULT_GEMMA });
    const s = await c.waitFor((e) => e.type === 'status');
    expect(s).toMatchObject({ gpu: true, loaded: DEFAULT_GEMMA, cached: true });
  });

  it('T3.11 chat emits delta... then done; abort of the running chat ends it as aborted, never done', async () => {
    const c = await loaded();
    c.send({ type: 'chat', id: 'one', req: { ...req('hi'), system: 'sys' } });
    await c.waitFor(ended('one'));
    expect(c.of('one').map((e) => e.type)).toEqual(['delta', 'delta', 'delta', 'done']);
    expect(state.creates[0]).toBe('sys\n\n---\n\nhi');

    c.send({ type: 'chat', id: 'two', req: req('hi') });
    await c.waitFor((e) => e.type === 'delta' && e.id === 'two');
    c.send({ type: 'abort', id: 'two' });
    const end = await c.waitFor(ended('two'));
    expect(end).toMatchObject({ type: 'error', kind: 'aborted' });
    expect(c.of('two').filter((e) => e.type === 'delta').length).toBeLessThan(3);
    expect(c.of('two').some((e) => e.type === 'done')).toBe(false);
  });

  it('T3.11 aborting a queued chat leaves the running one whole (same port and two ports)', async () => {
    for (const twoPorts of [false, true]) {
      state.creates = [];
      state.interrupts = 0;
      const a = await loaded();
      const b = twoPorts ? open() : a;
      a.send({ type: 'chat', id: 'A', req: req('a') });
      b.send({ type: 'chat', id: 'B', req: req('b') });
      await a.waitFor((e) => e.type === 'delta' && e.id === 'A');
      b.send({ type: 'abort', id: 'B' });
      await a.waitFor(ended('A'));
      expect(a.of('A').map((e) => (e.type === 'delta' ? e.text : e.type))).toEqual([
        'a',
        'b',
        'c',
        'done',
      ]);
      expect(await b.waitFor(ended('B'))).toMatchObject({ type: 'error', kind: 'aborted' });
      expect(state.interrupts).toBe(0);
      expect(state.creates).toEqual(['a']);
    }
  });

  it('T3.11 a stream cut short without an abort for its id ends in error, never done', async () => {
    const c = await loaded();
    state.calls = [{ endAbort: true }];
    c.send({ type: 'chat', id: 'A', req: req('a') });
    expect(await c.waitFor(ended('A'))).toMatchObject({ type: 'error', kind: 'other' });
    expect(c.of('A').some((e) => e.type === 'done')).toBe(false);
  });

  it("T3.11 a port can't abort another port's chat", async () => {
    const a = await loaded();
    const b = open();
    a.send({ type: 'chat', id: 'A', req: req('a') });
    await a.waitFor((e) => e.type === 'delta' && e.id === 'A');
    b.send({ type: 'abort', id: 'A' });
    await a.waitFor(ended('A'));
    expect(a.of('A').map((e) => e.type)).toEqual(['delta', 'delta', 'delta', 'done']);
    expect(state.interrupts).toBe(0);
  });

  it('T3.11 a disconnect mid-stream stops that chat; the next port starts without waiting for it', async () => {
    const a = await loaded();
    state.calls = [{ manual: true }];
    a.send({ type: 'chat', id: 'A', req: req('a') });
    for (let i = 0; i < 100 && !state.current; i++) await sleep(5);
    state.current?.wake();
    await a.waitFor((e) => e.type === 'delta' && e.id === 'A');
    a.disconnect();
    // A's stream is gated by hand and never released again: B can only run if A was stopped.
    const b = open();
    b.send({ type: 'chat', id: 'B', req: req('b') });
    await b.waitFor(ended('B'));
    expect(b.of('B').map((e) => e.type)).toEqual(['delta', 'delta', 'delta', 'done']);
    expect(a.of('A').map((e) => e.type)).toEqual(['delta']);
    expect(state.interrupts).toBe(1);
    expect(state.creates).toEqual(['a', 'b']);
  });

  it('T3.11 a Port whose post throws (closed without onDisconnect) has its chat stopped', async () => {
    const a = await loaded();
    a.send({ type: 'chat', id: 'A', req: req('a') });
    await a.waitFor((e) => e.type === 'delta' && e.id === 'A');
    a.port.postMessage = () => {
      throw new Error('Attempting to use a disconnected port object');
    };
    const b = open();
    b.send({ type: 'chat', id: 'B', req: req('b') });
    await b.waitFor(ended('B'));
    expect(state.interrupts).toBe(1);
    expect(a.of('A').map((e) => e.type)).toEqual(['delta']);
  });

  it('T3.11 a disconnect while queued: that chat never reaches the engine', async () => {
    const a = await loaded();
    const b = open();
    a.send({ type: 'chat', id: 'A', req: req('a') });
    b.send({ type: 'chat', id: 'B', req: req('b') });
    b.disconnect();
    await a.waitFor(ended('A'));
    a.send({ type: 'chat', id: 'C', req: req('c') });
    await a.waitFor(ended('C'));
    expect(state.creates).toEqual(['a', 'c']);
    expect(state.interrupts).toBe(0);
    expect(a.of('A').at(-1)?.type).toBe('done');
  });

  it('T3.11 abort or disconnect during a load: the shared load goes on, the chat never runs', async () => {
    const gate = deferred();
    state.loadGate = gate.promise;
    const a = open();
    const b = open();
    a.send({ type: 'load', modelId: DEFAULT_GEMMA });
    b.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await a.waitFor((e) => e.type === 'progress');
    a.send({ type: 'chat', id: 'X', req: req('x') });
    a.send({ type: 'abort', id: 'X' });
    a.disconnect();
    b.send({ type: 'chat', id: 'Y', req: req('y') });
    b.send({ type: 'abort', id: 'Y' });
    gate.resolve();
    await b.waitFor((e) => e.type === 'ready');
    expect(await b.waitFor(ended('Y'))).toMatchObject({ type: 'error', kind: 'aborted' });
    expect(a.events.some((e) => e.type === 'ready')).toBe(false);
    b.send({ type: 'chat', id: 'Z', req: req('z') });
    await b.waitFor(ended('Z'));
    expect(state.creates).toEqual(['z']);
  });

  it('T3.11 an interrupt lost before generation starts is sent again on the next chunk', async () => {
    const c = await loaded();
    state.loseInterrupts = 1;
    state.calls = [{ tokens: ['a', 'b', 'c', 'd', 'e'] }];
    c.send({ type: 'chat', id: 'A', req: req('a') });
    // Abort once the engine was asked to generate but before the first token: the engine drops it.
    for (let i = 0; i < 100 && !state.current; i++) await sleep(1);
    c.send({ type: 'abort', id: 'A' });
    expect(await c.waitFor(ended('A'))).toMatchObject({ type: 'error', kind: 'aborted' });
    expect(c.of('A').filter((e) => e.type === 'delta').length).toBeLessThan(2);
    expect(state.interrupts).toBeGreaterThanOrEqual(2);
    expect(state.creates).toEqual(['a']);
    c.send({ type: 'chat', id: 'B', req: req('b') });
    expect(await c.waitFor(ended('B'))).toMatchObject({ type: 'done' });
  });

  it('T3.11 errors during cleanup (interrupt throws, dead port throws) never stall the queue', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const a = await loaded();
      state.interruptThrows = true;
      a.send({ type: 'chat', id: 'A', req: req('a') });
      await a.waitFor((e) => e.type === 'delta' && e.id === 'A');
      a.disconnect();
      const b = open();
      b.send({ type: 'chat', id: 'B', req: req('b') });
      await b.waitFor(ended('B'));
      expect(b.of('B').map((e) => e.type)).toEqual(['delta', 'delta', 'delta', 'done']);
      expect(state.interrupts).toBeGreaterThanOrEqual(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('T3.11 a stream that throws mid-chat gives an error; the next chat runs', async () => {
    const c = await loaded();
    state.calls = [{ throwAt: 1 }];
    c.send({ type: 'chat', id: 'A', req: req('a') });
    expect(await c.waitFor(ended('A'))).toMatchObject({ type: 'error', message: 'decode failed' });
    c.send({ type: 'chat', id: 'B', req: req('b') });
    expect(await c.waitFor(ended('B'))).toMatchObject({ type: 'done' });
  });

  it('T3.11 a duplicate id on one port is refused; the first chat is untouched', async () => {
    const c = await loaded();
    c.send({ type: 'chat', id: 'A', req: req('a') });
    c.send({ type: 'chat', id: 'A', req: req('again') });
    await c.waitFor((e) => e.type === 'done' && e.id === 'A');
    const types = c.of('A').map((e) => e.type);
    expect(types.filter((t) => t === 'error')).toHaveLength(1);
    expect(types.filter((t) => t === 'delta')).toHaveLength(3);
    expect(state.creates).toEqual(['a']);
  });

  it('T3.11 errors become error events: unknown model, failed download, no WebGPU', async () => {
    const c = open();
    c.send({ type: 'load', modelId: 'not-a-model' });
    expect(await c.waitFor((e) => e.type === 'error')).toMatchObject({ kind: 'other' });

    state.failCreate = new Error('Failed to fetch shard');
    const c2 = open();
    c2.send({ type: 'load', modelId: DEFAULT_GEMMA });
    expect(await c2.waitFor((e) => e.type === 'error')).toMatchObject({ kind: 'network' });

    vi.stubGlobal('navigator', {});
    const c3 = open();
    c3.send({ type: 'load', modelId: DEFAULT_GEMMA });
    expect(await c3.waitFor((e) => e.type === 'error')).toMatchObject({ kind: 'unsupported' });
    c3.send({ type: 'status' });
    expect(await c3.waitFor((e) => e.type === 'status')).toMatchObject({ gpu: false });
  });

  it('T3.11 delete: a rejection is an error event; deleting the loaded model unloads it', async () => {
    const c = await loaded();
    state.failDelete = new Error('cache locked');
    c.send({ type: 'delete', modelId: DEFAULT_GEMMA });
    expect(await c.waitFor((e) => e.type === 'error')).toMatchObject({ kind: 'other' });

    state.failDelete = undefined;
    const c2 = await loaded();
    c2.send({ type: 'delete', modelId: DEFAULT_GEMMA });
    await c2.waitFor((e) => e.type === 'deleted');
    c2.send({ type: 'status' });
    const s = await c2.waitFor((e) => e.type === 'status');
    expect(s).toMatchObject({ loading: false });
    expect((s as { loaded?: string }).loaded).toBeUndefined();
  });

  it("T3.11 the council's in-page Port: chats run, and its disconnect stops only its own chat", async () => {
    const other = await loaded();
    const [client, end] = createPortPair('llm');
    host.attachLlmPort(end as unknown as chrome.runtime.Port);
    const got: LlmEvent[] = [];
    client.onMessage.addListener(((m: LlmEvent) => void got.push(m)) as never);

    client.postMessage({ type: 'chat', id: 'C1', req: req('c1') });
    await waitFor(got, ended('C1'));
    expect(got.filter((e) => 'id' in e && e.id === 'C1').map((e) => e.type)).toEqual([
      'delta',
      'delta',
      'delta',
      'done',
    ]);

    state.calls = [{ manual: true }];
    client.postMessage({ type: 'chat', id: 'C2', req: req('c2') });
    // The in-page Port delivers on a microtask: queue O only once C2 is generating.
    for (let i = 0; i < 100 && !state.current; i++) await sleep(5);
    other.send({ type: 'chat', id: 'O', req: req('o') });
    client.disconnect();
    await other.waitFor(ended('O'));
    expect(other.of('O').map((e) => e.type)).toEqual(['delta', 'delta', 'delta', 'done']);
    expect(state.creates).toEqual(['c1', 'c2', 'o']);
  });
  /** Start a chat whose stream only moves when the test says so, and wait for it to be generating. */
  async function hung(c: FakePort, id: string) {
    state.calls = [{ manual: true }];
    c.send({ type: 'chat', id, req: req(id) });
    for (let i = 0; i < 100 && !state.current; i++) await sleep(5);
    expect(state.current).not.toBeNull();
  }
  async function nextChatRuns() {
    const n = await loaded();
    n.send({ type: 'chat', id: 'N', req: req('n') });
    expect(await n.waitFor(ended('N'))).toMatchObject({ type: 'done' });
  }

  it('T3.11 unload or delete mid-stream ends that chat in error and frees the queue', async () => {
    for (const msg of [
      { type: 'unload' } as const,
      { type: 'delete', modelId: DEFAULT_GEMMA } as const,
    ]) {
      const a = await loaded();
      await hung(a, 'A');
      open().send(msg);
      const end = await a.waitFor(ended('A'));
      expect(end).toMatchObject({ type: 'error', kind: 'other' });
      expect((end as { message: string }).message).toMatch(/unloaded/);
      expect(a.of('A').some((e) => e.type === 'done')).toBe(false);
      await nextChatRuns();
    }
  });

  it('T3.11 loading another model mid-stream ends that chat in error', async () => {
    const other = GEMMA_MODELS.find((m) => m.id !== DEFAULT_GEMMA);
    expect(other).toBeDefined();
    const a = await loaded();
    await hung(a, 'A');
    const b = open();
    b.send({ type: 'load', modelId: other?.id ?? '' });
    expect(await a.waitFor(ended('A'))).toMatchObject({ type: 'error', kind: 'other' });
    await b.waitFor((e) => e.type === 'ready');
    b.send({ type: 'chat', id: 'B', req: req('b') });
    expect(await b.waitFor(ended('B'))).toMatchObject({ type: 'done' });
  });

  it('T3.11 a worker crash mid-stream ends that chat in error, unloads, and the next load works', async () => {
    const a = await loaded();
    await hung(a, 'A');
    state.worker?.fire('error');
    const end = await a.waitFor(ended('A'));
    expect((end as { message: string }).message).toMatch(/stopped unexpectedly/);
    a.send({ type: 'status' });
    expect((await a.waitFor((e) => e.type === 'status')) as { loaded?: string }).toMatchObject({
      loaded: undefined,
    });
    await nextChatRuns();
  });

  it('T3.11 a stop on a chat whose engine is gone still frees the queue', async () => {
    const a = await loaded();
    await hung(a, 'A');
    // The interrupt fails, so the stopped stream never drains: only the unload can free it.
    state.interruptThrows = true;
    a.disconnect();
    await sleep(30);
    expect(state.current).not.toBeNull();
    open().send({ type: 'unload' });
    await nextChatRuns();
  });

  it('T3.11 only extension pages can use the llm Port (not content scripts on web pages)', async () => {
    const page = open('https://example.com/');
    page.send({ type: 'status' });
    page.send({ type: 'unload' });
    await sleep(30);
    expect(page.events).toEqual([]);
    const ext = open('chrome-extension://specimen/options.html');
    ext.send({ type: 'status' });
    expect(await ext.waitFor((e) => e.type === 'status')).toMatchObject({ gpu: true });
  });
});
