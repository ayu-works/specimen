import type { LlmEvent, LlmRequest } from '@specimen/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake WebLLM engine: streams three tokens slowly enough to abort.
const state = vi.hoisted(() => ({
  create: undefined as undefined | (() => Promise<unknown>),
  failCreate: undefined as undefined | Error,
}));

vi.mock('@mlc-ai/web-llm', () => {
  const engine = {
    interruptGenerate: vi.fn(),
    unload: vi.fn(async () => {}),
    chat: {
      completions: {
        create: vi.fn(async () => {
          async function* gen() {
            for (const t of ['a', 'b', 'c']) {
              await new Promise((r) => setTimeout(r, 15));
              yield { choices: [{ delta: { content: t } }] };
            }
          }
          return gen();
        }),
      },
    },
  };
  return {
    CreateWebWorkerMLCEngine: vi.fn(
      async (
        _w: unknown,
        _id: string,
        opts: { initProgressCallback: (r: { progress: number; text: string }) => void },
      ) => {
        if (state.failCreate) throw state.failCreate;
        opts.initProgressCallback({ progress: 0.5, text: 'half' });
        opts.initProgressCallback({ progress: 1, text: 'done' });
        return engine;
      },
    ),
    hasModelInCache: vi.fn(async () => true),
    deleteModelAllInfoInCache: vi.fn(async () => {}),
  };
});
vi.mock('@/lib/webllmConfig', () => ({ buildAppConfig: () => ({ model_list: [] }) }));

import { DEFAULT_GEMMA } from '@/lib/gemmaModels';
import { llmBusy, startLlmHost } from '../../src/entrypoints/offscreen/llmHost';

type Listener<T> = (m: T) => void;
let connect: (port: unknown) => void;

function makePort() {
  const events: LlmEvent[] = [];
  let onMsg: Listener<LlmRequest> = () => {};
  const port = {
    name: 'llm',
    postMessage: (e: LlmEvent) => void events.push(e),
    onMessage: { addListener: (cb: Listener<LlmRequest>) => (onMsg = cb) },
    onDisconnect: { addListener: () => {} },
  };
  return {
    port,
    events,
    send: (m: LlmRequest) => onMsg(m),
    waitFor: async (pred: (e: LlmEvent) => boolean) => {
      for (let i = 0; i < 200; i++) {
        const hit = events.find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error(`timed out; got ${JSON.stringify(events)}`);
    },
  };
}

beforeEach(() => {
  state.failCreate = undefined;
  vi.stubGlobal(
    'Worker',
    class {
      terminate() {}
    },
  );
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (p: string) => p,
      onConnect: { addListener: (cb: (p: unknown) => void) => (connect = cb) },
    },
  });
});

describe('llm Port protocol (host)', () => {
  it('T3.11 load emits progress then ready; status then reports the loaded model', async () => {
    startLlmHost();
    const c = makePort();
    connect(c.port);
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await c.waitFor((e) => e.type === 'ready');
    const types = c.events.map((e) => e.type);
    expect(types.slice(0, 3)).toEqual(['progress', 'progress', 'ready']);
    expect(llmBusy()).toBe(true);
    c.send({ type: 'status', modelId: DEFAULT_GEMMA });
    const s = await c.waitFor((e) => e.type === 'status');
    expect(s).toMatchObject({ gpu: true, loaded: DEFAULT_GEMMA, cached: true });
  });

  it('T3.11 chat emits delta... then done; abort stops the stream', async () => {
    startLlmHost();
    const c = makePort();
    connect(c.port);
    c.send({ type: 'load', modelId: DEFAULT_GEMMA });
    await c.waitFor((e) => e.type === 'ready');
    const req = { messages: [{ role: 'user' as const, content: 'hi' }], system: 'sys' };

    c.send({ type: 'chat', id: 'one', req });
    await c.waitFor((e) => e.type === 'done' && e.id === 'one');
    const one = c.events.filter((e) => 'id' in e && e.id === 'one').map((e) => e.type);
    expect(one).toEqual(['delta', 'delta', 'delta', 'done']);

    c.send({ type: 'chat', id: 'two', req });
    await c.waitFor((e) => e.type === 'delta' && e.id === 'two');
    c.send({ type: 'abort', id: 'two' });
    await c.waitFor((e) => e.type === 'done' && e.id === 'two');
    const deltas = c.events.filter((e) => e.type === 'delta' && e.id === 'two');
    expect(deltas.length).toBeLessThan(3);
  });

  it('T3.11 errors become error events: unknown model and a failed download', async () => {
    startLlmHost();
    const c = makePort();
    connect(c.port);
    c.send({ type: 'load', modelId: 'not-a-model' });
    const bad = await c.waitFor((e) => e.type === 'error');
    expect(bad).toMatchObject({ type: 'error', kind: 'other' });

    state.failCreate = new Error('Failed to fetch shard');
    const c2 = makePort();
    connect(c2.port);
    // Unload so the next load really runs.
    c2.send({ type: 'unload' });
    c2.send({ type: 'load', modelId: DEFAULT_GEMMA });
    const net = await c2.waitFor((e) => e.type === 'error');
    expect(net).toMatchObject({ type: 'error', kind: 'network' });
  });
});
