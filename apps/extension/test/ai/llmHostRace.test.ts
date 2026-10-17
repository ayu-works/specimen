import type { LlmEvent, LlmRequest } from '@specimen/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SPC-37: an unload or delete that lands before a load has made its Worker, and a load that arrives
 * while a delete clears the cache. Each test holds one window open with a gate.
 *
 * The fake web-llm, Worker and chrome stubs are a trimmed copy of the ones in llmHost.test.ts
 * (source of truth). Keep the two in step until they move into a shared helper.
 */
const state = vi.hoisted(() => ({
  /** Held: `navigator.gpu.requestAdapter()` (the host's `hasGpu()`) waits for it. */
  gpuGate: null as null | Promise<void>,
  /** Held: `CreateWebWorkerMLCEngine` waits for it after its first progress report. */
  loadGate: null as null | Promise<void>,
  /** Held: `deleteModelAllInfoInCache` waits for it. */
  deleteGate: null as null | Promise<void>,
  failDelete: undefined as undefined | Error,
  /** Runs inside `Worker.terminate()`. */
  onTerminate: null as null | (() => void),
  /** Workers made, terminations, cache deletes and engines made, in call order. */
  log: [] as string[],
}));

vi.mock('@mlc-ai/web-llm', () => ({
  CreateWebWorkerMLCEngine: async (
    _w: unknown,
    _id: string,
    opts: { initProgressCallback: (r: { progress: number; text: string }) => void },
  ) => {
    const gate = state.loadGate;
    opts.initProgressCallback({ progress: 0.5, text: 'half' });
    if (gate) await gate;
    opts.initProgressCallback({ progress: 1, text: 'done' });
    state.log.push('engine');
    return { interruptGenerate: () => {}, unload: async () => {}, chat: { completions: {} } };
  },
  hasModelInCache: async () => false,
  deleteModelAllInfoInCache: async () => {
    state.log.push('delete');
    if (state.deleteGate) await state.deleteGate;
    if (state.failDelete) throw state.failDelete;
  },
}));
vi.mock('@/lib/webllmConfig', () => ({ buildAppConfig: () => ({ model_list: [] }) }));

import { DEFAULT_GEMMA, GEMMA_MODELS } from '@/lib/gemmaModels';

type Host = typeof import('../../src/entrypoints/offscreen/llmHost');
let host: Host;
let connect: (port: unknown) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const OTHER = GEMMA_MODELS.find((m) => m.id !== DEFAULT_GEMMA)?.id ?? '';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The client's end of a Port, as the host sees it. */
function open() {
  const events: LlmEvent[] = [];
  const onMsg = new Set<(m: LlmRequest) => void>();
  const onDisc = new Set<() => void>();
  let live = true;
  const port = {
    name: 'llm',
    sender: { url: 'chrome-extension://specimen/options.html' },
    postMessage: (e: LlmEvent) => {
      if (!live) throw new Error('Attempting to use a disconnected port object');
      events.push(e);
    },
    onMessage: { addListener: (cb: (m: LlmRequest) => void) => onMsg.add(cb) },
    onDisconnect: { addListener: (cb: () => void) => onDisc.add(cb) },
  };
  connect(port);
  const waitFor = async (pred: (e: LlmEvent) => boolean) => {
    for (let i = 0; i < 300; i++) {
      const hit = events.find(pred);
      if (hit) return hit;
      await sleep(5);
    }
    throw new Error(`timed out; got ${JSON.stringify(events)}`);
  };
  return {
    events,
    send: (m: LlmRequest) => {
      for (const cb of onMsg) cb(m);
    },
    disconnect: () => {
      live = false;
      for (const cb of onDisc) cb();
    },
    waitFor,
    /** Load outcomes (`ready`, or an `error` with no chat id): one per load sent. */
    loadEnds: () =>
      events.filter((e) => e.type === 'ready' || (e.type === 'error' && !('id' in e && e.id))),
    status: async () => {
      const before = events.length;
      for (const cb of onMsg) cb({ type: 'status' });
      await waitFor((e) => e.type === 'status' && events.indexOf(e) >= before);
      return events.filter((e) => e.type === 'status').at(-1) as Extract<
        LlmEvent,
        { type: 'status' }
      >;
    },
  };
}
type Client = ReturnType<typeof open>;

const isReady = (e: LlmEvent) => e.type === 'ready';
const loadError = (e: LlmEvent) => e.type === 'error' && !('id' in e && e.id);
const errorText = (c: Client) =>
  (c.events.find(loadError) as { message?: string } | undefined)?.message ?? '';

/** Every client disconnected and every gate open: nothing is loaded, loading or deleting. */
async function expectIdle(...clients: Client[]) {
  for (const c of clients) c.disconnect();
  await sleep(20);
  expect(host.llmBusy()).toBe(false);
}

beforeEach(async () => {
  Object.assign(state, {
    gpuGate: null,
    loadGate: null,
    deleteGate: null,
    failDelete: undefined,
    onTerminate: null,
    log: [],
  });
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        state.log.push('worker');
      }
      addEventListener() {}
      terminate() {
        state.log.push('terminate');
        state.onTerminate?.();
      }
    },
  );
  vi.stubGlobal('navigator', {
    gpu: {
      requestAdapter: async () => {
        if (state.gpuGate) await state.gpuGate;
        return {};
      },
    },
  });
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (p: string) => `chrome-extension://specimen/${p}`,
      onConnect: { addListener: (cb: (p: unknown) => void) => (connect = cb) },
    },
  });
  vi.resetModules();
  host = await import('../../src/entrypoints/offscreen/llmHost');
  host.startLlmHost();
});

describe('llm host: load vs unload/delete races (SPC-37)', () => {
  it('T3.37 a plain load still ends ready, and status reports it', async () => {
    const c = open();
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await c.waitFor(isReady);
    expect(c.loadEnds()).toHaveLength(1);
    expect(await c.status()).toMatchObject({ loaded: DEFAULT_GEMMA, loading: false });
  });

  it('T3.37 an unload while the load waits on the GPU check cancels it: no worker, no model', async () => {
    const gpu = deferred();
    state.gpuGate = gpu.promise;
    const c = open();
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await sleep(10);
    // (`status` would wait on the same GPU check.)
    expect(host.llmBusy()).toBe(true);
    c.send({ type: 'unload' });
    gpu.resolve();
    await c.waitFor(loadError);
    expect(errorText(c)).toMatch(/unloaded/);
    expect(c.loadEnds()).toHaveLength(1);
    expect(state.log).not.toContain('worker');
    expect(await c.status()).toMatchObject({ loaded: undefined, loading: false });
    await expectIdle(c);
  });

  it('T3.37 a delete while the load waits on the GPU check cancels it and clears the cache once', async () => {
    const gpu = deferred();
    state.gpuGate = gpu.promise;
    const c = open();
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await sleep(10);
    c.send({ type: 'delete', modelId: DEFAULT_GEMMA });
    await c.waitFor((e) => e.type === 'deleted');
    gpu.resolve();
    await c.waitFor(loadError);
    expect(errorText(c)).toMatch(/deleted/);
    await sleep(20);
    expect(state.log).toEqual(['delete']);
    expect(c.loadEnds()).toHaveLength(1);
    expect((await c.status()).loaded).toBeUndefined();
    await expectIdle(c);
  });

  it('T3.37 a delete of another model does not cancel a pending load', async () => {
    const gpu = deferred();
    state.gpuGate = gpu.promise;
    const c = open();
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await sleep(10);
    c.send({ type: 'delete', modelId: OTHER });
    await c.waitFor((e) => e.type === 'deleted');
    gpu.resolve();
    await c.waitFor(isReady);
    expect(c.events.some(loadError)).toBe(false);
  });

  it('T3.37 an unload after the load body is set up but before it runs: every waiter errors, no worker', async () => {
    // Load A, then switch to OTHER. The switch disposes A's engine synchronously (terminate), and an
    // unload queued from there runs before the new load body's first tick.
    const c = open();
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await c.waitFor(isReady);
    state.log = [];
    state.onTerminate = () => {
      state.onTerminate = null;
      queueMicrotask(() => c.send({ type: 'unload' }));
    };
    const b = open();
    const d = open();
    b.send({ type: 'load', modelId: OTHER });
    d.send({ type: 'load', modelId: OTHER });
    await b.waitFor(loadError);
    await d.waitFor(loadError);
    await sleep(20);
    expect(errorText(b)).toMatch(/unloaded/);
    for (const p of [b, d]) {
      expect(p.loadEnds()).toHaveLength(1);
      expect(p.events.some(isReady)).toBe(false);
    }
    expect(state.log).not.toContain('worker');
    expect((await c.status()).loaded).toBeUndefined();
    // A fresh load after the cancelled one works.
    b.send({ type: 'load', modelId: OTHER });
    await b.waitFor(isReady);
    expect((await b.status()).loaded).toBe(OTHER);
  });

  it('T3.37 an unload while a load waits behind another model’s load cancels both', async () => {
    const gate = deferred();
    state.loadGate = gate.promise;
    const a = open();
    a.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await a.waitFor((e) => e.type === 'progress');
    state.loadGate = null;
    const b = open();
    b.send({ type: 'load', modelId: OTHER });
    await sleep(10);
    a.send({ type: 'unload' });
    await a.waitFor(loadError);
    await b.waitFor(loadError);
    gate.resolve();
    await sleep(20);
    expect(errorText(b)).toMatch(/unloaded/);
    expect(state.log.filter((x) => x === 'worker')).toHaveLength(1);
    for (const p of [a, b]) expect(p.loadEnds()).toHaveLength(1);
    expect((await a.status()).loaded).toBeUndefined();
    await expectIdle(a, b);
  });

  it('T3.37 a load during a delete waits for it, then loads cleanly', async () => {
    const del = deferred();
    state.deleteGate = del.promise;
    const c = open();
    c.send({ type: 'delete', modelId: DEFAULT_GEMMA });
    await sleep(5);
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await sleep(20);
    expect(state.log).toEqual(['delete']);
    // The card can rejoin: a load is in progress, not "not downloaded".
    expect((await c.status()).loading).toBe(true);
    expect(host.llmBusy()).toBe(true);
    del.resolve();
    await c.waitFor((e) => e.type === 'deleted');
    await c.waitFor(isReady);
    expect(state.log).toEqual(['delete', 'worker', 'engine']);
    expect(c.loadEnds()).toHaveLength(1);
    expect((await c.status()).loaded).toBe(DEFAULT_GEMMA);
  });

  it('T3.37 a load during a delete that fails still loads; the delete reports its error', async () => {
    const del = deferred();
    state.deleteGate = del.promise;
    state.failDelete = new Error('quota');
    const d = open();
    const c = open();
    d.send({ type: 'delete', modelId: DEFAULT_GEMMA });
    await sleep(5);
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    del.resolve();
    await d.waitFor(loadError);
    await c.waitFor(isReady);
    expect(d.events.some((e) => e.type === 'deleted')).toBe(false);
    expect(c.loadEnds()).toHaveLength(1);
  });

  it('T3.37 two deletes then a load: the deletes run in turn and the load waits for both', async () => {
    const del = deferred();
    state.deleteGate = del.promise;
    const c = open();
    c.send({ type: 'delete', modelId: DEFAULT_GEMMA });
    c.send({ type: 'delete', modelId: DEFAULT_GEMMA });
    await sleep(5);
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await sleep(20);
    expect(state.log).toEqual(['delete']);
    del.resolve();
    await c.waitFor(isReady);
    expect(state.log).toEqual(['delete', 'delete', 'worker', 'engine']);
    expect(c.events.filter((e) => e.type === 'deleted')).toHaveLength(2);
    c.send({ type: 'unload' });
    await expectIdle(c);
  });

  it('T3.37 an unload after ready unloads without a second load event', async () => {
    const c = open();
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await c.waitFor(isReady);
    c.send({ type: 'unload' });
    await sleep(20);
    expect(c.loadEnds()).toHaveLength(1);
    expect((await c.status()).loaded).toBeUndefined();
    await expectIdle(c);
  });
});
