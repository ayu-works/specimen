import { mapThrown } from '../errors';
import type { LLMProvider } from '../types';
import { ProviderError } from '../types';

/** Minimal typing for Chrome's Prompt API (`LanguageModel` global). */
interface LanguageModelSession {
  promptStreaming(input: string, opts?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}
interface LanguageModelStatic {
  availability(
    opts?: unknown,
  ): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts?: unknown): Promise<LanguageModelSession>;
}

function api(): LanguageModelStatic | undefined {
  const lm = (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  return lm && typeof lm.availability === 'function' ? lm : undefined;
}

const LANG = { languages: ['en'] };
const OPTS = {
  expectedInputs: [{ type: 'text', ...LANG }],
  expectedOutputs: [{ type: 'text', ...LANG }],
};

/** True when the Prompt API exists and a model is usable (or downloadable). Hidden in the UI otherwise. */
export async function isChromeBuiltinAvailable(): Promise<boolean> {
  try {
    const lm = api();
    if (!lm) return false;
    return (await lm.availability(OPTS)) !== 'unavailable';
  } catch {
    return false;
  }
}

function text(content: string | { type: string; text?: string }[]): string {
  if (typeof content === 'string') return content;
  return content.map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join('\n');
}

export function createChromeBuiltin(): LLMProvider {
  return {
    id: 'chrome',
    label: 'Chrome built-in',
    capabilities: { vision: false, streaming: true, contextTokens: 4096 },
    async status() {
      const lm = api();
      if (!lm) return { state: 'error', detail: "This Chrome doesn't have the built-in model" };
      try {
        const a = await lm.availability(OPTS);
        if (a === 'available') return { state: 'ready' };
        if (a === 'downloadable' || a === 'downloading') {
          return { state: 'needs-setup', detail: 'Chrome will download its model on first use' };
        }
        return { state: 'error', detail: 'Not available on this device' };
      } catch (e) {
        return { state: 'error', detail: e instanceof Error ? e.message : String(e) };
      }
    },
    async *chat(req, signal) {
      const lm = api();
      if (!lm)
        throw new ProviderError('unsupported', "This Chrome doesn't have the built-in model.");
      let session: LanguageModelSession | undefined;
      try {
        const last = req.messages[req.messages.length - 1];
        if (last?.role !== 'user') throw new ProviderError('other', 'Nothing to send');
        const initialPrompts = [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          ...req.messages.slice(0, -1).map((m) => ({ role: m.role, content: text(m.content) })),
        ];
        session = await lm.create({ ...OPTS, initialPrompts, signal });
        const stream = session.promptStreaming(text(last.content), { signal });
        const reader = stream.getReader();
        const onAbort = () => void reader.cancel().catch(() => {});
        signal?.addEventListener('abort', onAbort);
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            if (done) return;
            // Current Chrome streams incremental chunks.
            if (value) yield value;
          }
        } finally {
          signal?.removeEventListener('abort', onAbort);
        }
      } catch (e) {
        throw mapThrown(e);
      } finally {
        session?.destroy();
      }
    },
  };
}
