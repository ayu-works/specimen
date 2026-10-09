import { describe, expect, it } from 'vitest';
import type { LlmEvent, LlmRequest, PortLike } from '../llmProtocol';
import { drain } from '../testing/testUtils';
import { createWebLLMProvider, WebLLMClient } from './webllm';

/** A fake Port wired to a scripted host: `script` answers each request with events. */
function fakePort(script: (msg: LlmRequest, emit: (e: LlmEvent) => void) => void) {
  const msgListeners = new Set<(m: LlmEvent) => void>();
  const discListeners = new Set<() => void>();
  const sent: LlmRequest[] = [];
  let disconnected = false;
  const emit = (e: LlmEvent) => {
    for (const l of [...msgListeners]) l(e);
  };
  const port: PortLike = {
    postMessage(msg) {
      sent.push(msg);
      queueMicrotask(() => script(msg, emit));
    },
    onMessage: {
      addListener: (cb) => msgListeners.add(cb),
      removeListener: (cb) => msgListeners.delete(cb),
    },
    onDisconnect: {
      addListener: (cb) => discListeners.add(cb),
      removeListener: (cb) => discListeners.delete(cb),
    },
    disconnect() {
      disconnected = true;
    },
  };
  return {
    port,
    sent,
    emit,
    dropConnection: () => {
      for (const l of [...discListeners]) l();
    },
    isDisconnected: () => disconnected,
  };
}

const REQ = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('llm Port protocol (client)', () => {
  it('T3.11 load: progress events then ready', async () => {
    const f = fakePort((m, emit) => {
      if (m.type !== 'load') return;
      emit({ type: 'progress', p: 0.25, text: 'a' });
      emit({ type: 'progress', p: 0.9, text: 'b' });
      emit({ type: 'ready', modelId: m.modelId });
    });
    const seen: [number, string][] = [];
    await new WebLLMClient(undefined, () => f.port).load('gemma', (p, t) => seen.push([p, t]));
    expect(f.sent).toEqual([{ type: 'load', modelId: 'gemma' }]);
    expect(seen).toEqual([
      [0.25, 'a'],
      [0.9, 'b'],
    ]);
    expect(f.isDisconnected()).toBe(true);
  });

  it('T3.11 load: an error event rejects with its kind', async () => {
    const f = fakePort((_m, emit) =>
      emit({ type: 'error', kind: 'unsupported', message: 'No WebGPU' }),
    );
    await expect(new WebLLMClient(undefined, () => f.port).load('gemma')).rejects.toMatchObject({
      kind: 'unsupported',
      message: 'No WebGPU',
    });
  });

  it('T3.11 chat: deltas then done, ignoring other request ids', async () => {
    const f = fakePort((m, emit) => {
      if (m.type !== 'chat') return;
      emit({ type: 'delta', id: 'other', text: 'NO' });
      emit({ type: 'delta', id: m.id, text: 'Hel' });
      emit({ type: 'delta', id: m.id, text: 'lo' });
      emit({ type: 'done', id: m.id });
    });
    const out = await drain(new WebLLMClient(undefined, () => f.port).chat(REQ));
    expect(out).toBe('Hello');
    expect(f.isDisconnected()).toBe(true);
  });

  it('T3.11 chat: an error event rejects mid-stream', async () => {
    const f = fakePort((m, emit) => {
      if (m.type !== 'chat') return;
      emit({ type: 'delta', id: m.id, text: 'x' });
      emit({ type: 'error', id: m.id, kind: 'other', message: 'GPU ran out of memory' });
    });
    await expect(drain(new WebLLMClient(undefined, () => f.port).chat(REQ))).rejects.toMatchObject({
      kind: 'other',
      message: 'GPU ran out of memory',
    });
  });

  it('T3.11 chat: abort posts an abort message for the same id and rejects as aborted', async () => {
    const f = fakePort(() => {
      /* host never answers */
    });
    const ac = new AbortController();
    const run = drain(new WebLLMClient(undefined, () => f.port).chat(REQ, ac.signal));
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    await expect(run).rejects.toMatchObject({ kind: 'aborted' });
    const chat = f.sent.find((m) => m.type === 'chat');
    const abort = f.sent.find((m) => m.type === 'abort');
    expect(chat && abort && 'id' in chat && 'id' in abort && chat.id === abort.id).toBe(true);
  });

  it('T3.11 chat: an already-aborted signal never opens a port', async () => {
    let opened = 0;
    const ac = new AbortController();
    ac.abort();
    const c = new WebLLMClient(undefined, () => {
      opened++;
      return fakePort(() => {}).port;
    });
    await expect(drain(c.chat(REQ, ac.signal))).rejects.toMatchObject({ kind: 'aborted' });
    expect(opened).toBe(0);
  });

  it('T3.11 a dropped port surfaces as a network error', async () => {
    const f = fakePort(() => {});
    const run = drain(new WebLLMClient(undefined, () => f.port).chat(REQ));
    await new Promise((r) => setTimeout(r, 5));
    f.dropConnection();
    await expect(run).rejects.toMatchObject({ kind: 'network' });
  });

  it('T3.11 status/delete round trips; ensure() runs before connecting', async () => {
    const order: string[] = [];
    const f = fakePort((m, emit) => {
      if (m.type === 'status') emit({ type: 'status', gpu: true, loaded: 'g', cached: true });
      if (m.type === 'delete') emit({ type: 'deleted', modelId: m.modelId });
    });
    const c = new WebLLMClient(
      async () => void order.push('ensure'),
      () => {
        order.push('connect');
        return f.port;
      },
    );
    expect(await c.status('g')).toMatchObject({
      gpu: true,
      loaded: 'g',
      cached: true,
      loading: false,
    });
    await c.remove('g');
    expect(order.slice(0, 2)).toEqual(['ensure', 'connect']);
  });

  it('T3.11 provider: refuses without WebGPU and without downloaded weights; streams when loaded', async () => {
    const mk = (status: Extract<LlmEvent, { type: 'status' }>) =>
      createWebLLMProvider({
        modelId: 'g',
        connect: () =>
          fakePort((m, emit) => {
            if (m.type === 'status') emit(status);
            if (m.type === 'load') emit({ type: 'ready', modelId: 'g' });
            if (m.type === 'chat') {
              emit({ type: 'delta', id: m.id, text: 'ok' });
              emit({ type: 'done', id: m.id });
            }
          }).port,
      });
    await expect(drain(mk({ type: 'status', gpu: false }).chat(REQ))).rejects.toMatchObject({
      kind: 'unsupported',
    });
    await expect(drain(mk({ type: 'status', gpu: true }).chat(REQ))).rejects.toThrow(/Download/);
    expect(await drain(mk({ type: 'status', gpu: true, loaded: 'g' }).chat(REQ))).toBe('ok');
    expect(await drain(mk({ type: 'status', gpu: true, cached: true }).chat(REQ))).toBe('ok');
    expect((await mk({ type: 'status', gpu: true, loaded: 'g' }).status()).state).toBe('ready');
    expect((await mk({ type: 'status', gpu: false }).status()).state).toBe('error');
  });
});
