import { afterEach, describe, expect, it, vi } from 'vitest';
import { drain } from '../testing/testUtils';
import type { ChatRequest } from '../types';
import { ProviderError } from '../types';
import { createChromeBuiltin, isChromeBuiltinAvailable } from './chromeBuiltin';

afterEach(() => vi.unstubAllGlobals());

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

const REQ: ChatRequest = {
  system: 'sys',
  messages: [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: [{ type: 'text', text: 'last' }] },
  ],
};

/** A stream that emits `chunks`, then either ends, errors, or hangs until cancelled. */
function chunkStream(chunks: string[], end: 'close' | 'error' | 'hang' = 'close') {
  const cancel = vi.fn();
  const stream = new ReadableStream<string>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      if (end === 'close') c.close();
      if (end === 'error') c.error(new DOMException('The model crashed', 'UnknownError'));
    },
    cancel,
  });
  return { stream, cancel };
}

function stubLM(
  opts: {
    availability?: Availability | (() => Promise<Availability>);
    create?: () => Promise<unknown>;
    stream?: () => ReadableStream<string>;
    destroy?: () => void;
  } = {},
) {
  const destroy = vi.fn(opts.destroy ?? (() => {}));
  const promptStreaming = vi.fn((_input: string, _o?: { signal?: AbortSignal }) =>
    opts.stream ? opts.stream() : chunkStream(['Hel', 'lo']).stream,
  );
  const session = { promptStreaming, destroy };
  const create = vi.fn(opts.create ?? (async (_o?: unknown) => session));
  const a = opts.availability ?? 'available';
  const availability = vi.fn(typeof a === 'function' ? a : async () => a);
  vi.stubGlobal('LanguageModel', { availability, create });
  return { availability, create, promptStreaming, destroy };
}

describe('chromeBuiltin status', () => {
  it('T3.06 reports each availability state', async () => {
    const p = createChromeBuiltin();
    expect(await p.status()).toMatchObject({ state: 'error' }); // no LanguageModel global
    stubLM({ availability: 'available' });
    expect(await p.status()).toEqual({ state: 'ready' });
    stubLM({ availability: 'downloadable' });
    expect((await p.status()).state).toBe('needs-setup');
    stubLM({ availability: 'downloading' });
    expect((await p.status()).state).toBe('needs-setup');
    stubLM({ availability: 'unavailable' });
    expect((await p.status()).state).toBe('error');
    stubLM({
      availability: async () => {
        throw new Error('blocked by policy');
      },
    });
    expect(await p.status()).toMatchObject({ state: 'error', detail: 'blocked by policy' });
  });

  it('T3.06 isChromeBuiltinAvailable is false when missing, unavailable or throwing', async () => {
    expect(await isChromeBuiltinAvailable()).toBe(false);
    vi.stubGlobal('LanguageModel', { availability: 'not a function' });
    expect(await isChromeBuiltinAvailable()).toBe(false);
    stubLM({ availability: 'unavailable' });
    expect(await isChromeBuiltinAvailable()).toBe(false);
    stubLM({
      availability: async () => {
        throw new Error('x');
      },
    });
    expect(await isChromeBuiltinAvailable()).toBe(false);
    stubLM({ availability: 'downloadable' });
    expect(await isChromeBuiltinAvailable()).toBe(true);
  });
});

describe('chromeBuiltin chat', () => {
  it('T3.06 rejects as "unsupported" without the LanguageModel global', async () => {
    await expect(drain(createChromeBuiltin().chat(REQ))).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'unsupported',
    });
  });

  it('T3.06 streams chunks, passes system + history as initialPrompts, destroys the session once', async () => {
    const lm = stubLM();
    const ac = new AbortController();
    expect(await drain(createChromeBuiltin().chat(REQ, ac.signal))).toBe('Hello');
    expect(lm.create.mock.calls[0]?.[0]).toMatchObject({ signal: ac.signal });
    expect(lm.promptStreaming.mock.calls[0]?.[1]).toEqual({ signal: ac.signal });
    expect(lm.create).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPrompts: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'reply' },
        ],
      }),
    );
    expect(lm.promptStreaming.mock.calls[0]?.[0]).toBe('last');
    expect(lm.destroy).toHaveBeenCalledTimes(1);
  });

  it('T3.06 a last message not from the user rejects before creating a session', async () => {
    const lm = stubLM();
    const req: ChatRequest = { messages: [{ role: 'assistant', content: 'x' }] };
    await expect(drain(createChromeBuiltin().chat(req))).rejects.toMatchObject({ kind: 'other' });
    expect(lm.create).not.toHaveBeenCalled();
  });

  it('T3.06 an already-aborted signal rejects as "aborted" and never streams', async () => {
    const ac = new AbortController();
    ac.abort();
    const lm = stubLM();
    await expect(drain(createChromeBuiltin().chat(REQ, ac.signal))).rejects.toMatchObject({
      kind: 'aborted',
    });
    // The adapter checks the signal itself; it doesn't rely on Chrome honouring it.
    expect(lm.create).not.toHaveBeenCalled();
    expect(lm.promptStreaming).not.toHaveBeenCalled();
    expect(lm.destroy).not.toHaveBeenCalled();
  });

  it('T3.06 aborting mid-stream rejects as "aborted", cancels the reader and destroys once', async () => {
    const s = chunkStream(['a'], 'hang');
    const lm = stubLM({ stream: () => s.stream });
    const ac = new AbortController();
    const seen: string[] = [];
    const run = (async () => {
      for await (const d of createChromeBuiltin().chat(REQ, ac.signal)) {
        seen.push(d);
        ac.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ name: 'ProviderError', kind: 'aborted' });
    expect(seen).toEqual(['a']);
    expect(s.cancel).toHaveBeenCalled();
    expect(lm.destroy).toHaveBeenCalledTimes(1);
  });

  it('T3.06 create() failing is mapped and there is no session to destroy', async () => {
    const lm = stubLM({
      create: async () => {
        throw new DOMException('Model not ready', 'NotSupportedError');
      },
    });
    const e = await drain(createChromeBuiltin().chat(REQ)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toMatchObject({ kind: 'other' });
    expect(lm.destroy).not.toHaveBeenCalled();
  });

  it('T3.06 a stream error is mapped and the session is destroyed once', async () => {
    const lm = stubLM({ stream: () => chunkStream(['a'], 'error').stream });
    await expect(drain(createChromeBuiltin().chat(REQ))).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'other',
    });
    expect(lm.destroy).toHaveBeenCalledTimes(1);
  });

  it('T3.06 destroy() throwing never masks the real error', async () => {
    stubLM({
      stream: () => chunkStream([], 'error').stream,
      destroy: () => {
        throw new Error('destroy failed');
      },
    });
    const e = await drain(createChromeBuiltin().chat(REQ)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect((e as Error).message).toMatch(/model crashed/);
  });

  it('T3.06 destroy() throwing never turns a finished answer into a failure', async () => {
    stubLM({
      destroy: () => {
        throw new Error('destroy failed');
      },
    });
    expect(await drain(createChromeBuiltin().chat(REQ))).toBe('Hello');
  });
});
