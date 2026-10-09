import { type ChatRequest, type LLMProvider, ProviderError } from '../types';

export interface MockProviderOptions {
  id?: string;
  label?: string;
  /** Full answer, streamed in `chunkSize` pieces. Ignored when `chunks` is set. */
  text?: string;
  chunks?: string[];
  chunkSize?: number;
  /** Delay between chunks, so UI tests can observe streaming and abort mid-way. */
  delayMs?: number;
  vision?: boolean;
  contextTokens?: number;
  /** Throw this instead of finishing the stream (after `errorAfter` chunks). */
  error?: ProviderError;
  /** Number of chunks to emit before throwing `error`. Default 0. */
  errorAfter?: number;
  /** Compute the answer from the request instead of using fixed text. */
  respond?: (req: ChatRequest) => string;
  state?: Awaited<ReturnType<LLMProvider['status']>>;
}

export interface MockProvider extends LLMProvider {
  /** Every request passed to `chat`, in order. */
  readonly calls: ChatRequest[];
}

function split(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/** A provider that streams canned text. For unit and UI tests; never registered in production. */
export function createMockProvider(opts: MockProviderOptions = {}): MockProvider {
  const calls: ChatRequest[] = [];
  return {
    id: opts.id ?? 'mock',
    label: opts.label ?? 'Mock AI',
    capabilities: {
      vision: opts.vision ?? false,
      streaming: true,
      contextTokens: opts.contextTokens ?? 8192,
    },
    calls,
    async status() {
      return opts.state ?? { state: 'ready' };
    },
    async *chat(req, signal) {
      calls.push(req);
      if (signal?.aborted) throw new ProviderError('aborted', 'Stopped');
      const text = opts.respond ? opts.respond(req) : (opts.text ?? 'Mock answer.');
      const chunks = opts.chunks ?? split(text, opts.chunkSize ?? 8);
      let n = 0;
      for (const c of chunks) {
        if (opts.error && n >= (opts.errorAfter ?? 0)) throw opts.error;
        if (opts.delayMs) await wait(opts.delayMs, signal);
        if (signal?.aborted) throw new ProviderError('aborted', 'Stopped');
        yield c;
        n++;
      }
      if (opts.error) throw opts.error;
    },
  };
}
