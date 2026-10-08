import type { LlmEvent, PortLike } from '../llmProtocol';
import { LLM_PORT } from '../llmProtocol';
import type { LLMProvider } from '../types';
import { ProviderError } from '../types';

export interface WebLLMOptions {
  modelId: string;
  label?: string;
  contextTokens?: number;
  /** Ask the background to create the offscreen document first. */
  ensure?: () => Promise<void>;
  /** Open the `llm` Port. Defaults to `chrome.runtime.connect({ name: 'llm' })`. */
  connect?: () => PortLike;
}

function defaultConnect(): PortLike {
  // The one place this package touches the extension API; tests inject `connect` instead.
  const rt = (globalThis as { chrome?: { runtime?: { connect(info: { name: string }): unknown } } })
    .chrome?.runtime;
  if (!rt) throw new ProviderError('unsupported', 'Local models only work inside the extension.');
  return rt.connect({ name: LLM_PORT }) as PortLike;
}

export interface WebLLMStatus {
  loaded?: string;
  loading: boolean;
  p?: number;
  gpu: boolean;
  cached?: boolean;
}

/**
 * Thin client for the offscreen `llm` Port protocol. One short-lived Port per operation keeps
 * lifetimes simple: the engine itself lives in the offscreen document, not in the Port.
 */
export class WebLLMClient {
  constructor(
    private readonly ensure?: () => Promise<void>,
    private readonly connect: () => PortLike = defaultConnect,
  ) {}

  private async open(): Promise<PortLike> {
    await this.ensure?.();
    return this.connect();
  }

  /** Run `body` against a fresh Port; the Port is closed afterwards. */
  private async withPort<T>(
    body: (port: PortLike, events: AsyncQueue<LlmEvent>) => Promise<T>,
  ): Promise<T> {
    const port = await this.open();
    const q = new AsyncQueue<LlmEvent>();
    const onMsg = (m: LlmEvent) => q.push(m);
    const onDisc = () =>
      q.fail(new ProviderError('network', 'The local model process went away. Try again.'));
    port.onMessage.addListener(onMsg);
    port.onDisconnect.addListener(onDisc);
    try {
      return await body(port, q);
    } finally {
      port.onMessage.removeListener(onMsg);
      port.onDisconnect.removeListener(onDisc);
      try {
        port.disconnect();
      } catch {
        /* already closed */
      }
    }
  }

  async status(modelId?: string): Promise<WebLLMStatus> {
    return this.withPort(async (port, q) => {
      port.postMessage({ type: 'status', modelId });
      for (;;) {
        const ev = await q.next();
        if (ev.type === 'status') {
          return {
            loaded: ev.loaded,
            loading: ev.loading ?? false,
            p: ev.p,
            gpu: ev.gpu,
            cached: ev.cached,
          };
        }
      }
    });
  }

  /** Download (if needed) and load a model; resolves on `ready`. Progress is 0..1. */
  async load(
    modelId: string,
    onProgress?: (p: number, text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.withPort(async (port, q) => {
      const onAbort = () => q.fail(new ProviderError('aborted', 'Stopped'));
      signal?.addEventListener('abort', onAbort);
      try {
        port.postMessage({ type: 'load', modelId });
        for (;;) {
          const ev = await q.next();
          if (ev.type === 'progress') onProgress?.(ev.p, ev.text);
          else if (ev.type === 'ready') return;
          else if (ev.type === 'error') throw new ProviderError(ev.kind, ev.message);
        }
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    });
  }

  async unload(): Promise<void> {
    await this.withPort(async (port) => port.postMessage({ type: 'unload' }));
  }

  /** Remove the downloaded weights for `modelId` from the browser cache. */
  async remove(modelId: string): Promise<void> {
    return this.withPort(async (port, q) => {
      port.postMessage({ type: 'delete', modelId });
      for (;;) {
        const ev = await q.next();
        if (ev.type === 'deleted') return;
        if (ev.type === 'error') throw new ProviderError(ev.kind, ev.message);
      }
    });
  }

  /** Stream a chat. The caller must have loaded the model. */
  async *chat(
    req: Parameters<LLMProvider['chat']>[0],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (signal?.aborted) throw new ProviderError('aborted', 'Stopped');
    const port = await this.open();
    const q = new AsyncQueue<LlmEvent>();
    const onMsg = (m: LlmEvent) => q.push(m);
    const onDisc = () =>
      q.fail(new ProviderError('network', 'The local model process went away. Try again.'));
    port.onMessage.addListener(onMsg);
    port.onDisconnect.addListener(onDisc);
    const id = Math.random().toString(36).slice(2);
    const onAbort = () => {
      try {
        port.postMessage({ type: 'abort', id });
      } catch {
        /* port gone */
      }
      q.fail(new ProviderError('aborted', 'Stopped'));
    };
    signal?.addEventListener('abort', onAbort);
    try {
      port.postMessage({ type: 'chat', id, req });
      for (;;) {
        const ev = await q.next();
        if (ev.type === 'delta' && ev.id === id) yield ev.text;
        else if (ev.type === 'done' && ev.id === id) return;
        else if (ev.type === 'error' && (ev.id === id || ev.id === undefined)) {
          throw new ProviderError(ev.kind, ev.message);
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      port.onMessage.removeListener(onMsg);
      port.onDisconnect.removeListener(onDisc);
      try {
        port.disconnect();
      } catch {
        /* already closed */
      }
    }
  }
}

/** Minimal unbounded async queue with failure injection. */
class AsyncQueue<T> {
  private items: T[] = [];
  private waiter: { resolve: (v: T) => void; reject: (e: unknown) => void } | null = null;
  private error: unknown = null;
  push(v: T) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.resolve(v);
    } else this.items.push(v);
  }
  fail(e: unknown) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.reject(e);
    } else if (this.error === null) this.error = e;
  }
  next(): Promise<T> {
    if (this.error !== null) return Promise.reject(this.error);
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise<T>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }
}

/** Local Gemma through WebLLM in the offscreen document. */
export function createWebLLMProvider(opts: WebLLMOptions): LLMProvider {
  const client = new WebLLMClient(opts.ensure, opts.connect);
  return {
    id: 'webllm',
    label: opts.label ?? 'Local Gemma',
    capabilities: { vision: false, streaming: true, contextTokens: opts.contextTokens ?? 4096 },
    async status() {
      try {
        const s = await client.status(opts.modelId);
        if (!s.gpu) return { state: 'error', detail: 'WebGPU is not available in this browser' };
        if (s.loaded === opts.modelId) return { state: 'ready' };
        if (s.loading) return { state: 'downloading', progress: s.p };
        if (s.cached) return { state: 'ready', detail: 'Loads on first use' };
        return { state: 'needs-setup', detail: 'Download the model in Settings' };
      } catch (e) {
        return { state: 'error', detail: e instanceof Error ? e.message : String(e) };
      }
    },
    async *chat(req, signal) {
      const s = await client.status(opts.modelId);
      if (!s.gpu) {
        throw new ProviderError(
          'unsupported',
          'Local Gemma needs WebGPU, which this browser does not have.',
        );
      }
      if (s.loaded !== opts.modelId) {
        if (!s.cached && !s.loading) {
          throw new ProviderError('other', 'Download the local model in Settings first.');
        }
        await client.load(opts.modelId, undefined, signal);
      }
      yield* client.chat(req, signal);
    },
  };
}
