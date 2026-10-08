import type { ChatRequest, ProviderErrorKind } from './types';

/** Port name used between the side panel / options page and the offscreen document. */
export const LLM_PORT = 'llm';

/** Client -> offscreen. */
export type LlmRequest =
  | { type: 'load'; modelId: string }
  | { type: 'chat'; id: string; req: ChatRequest }
  | { type: 'abort'; id: string }
  | { type: 'unload' }
  | { type: 'delete'; modelId: string }
  | { type: 'status'; modelId?: string };

/** Offscreen -> client. */
export type LlmEvent =
  | { type: 'progress'; p: number; text: string }
  | { type: 'ready'; modelId: string }
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; id: string }
  | { type: 'error'; id?: string; kind: ProviderErrorKind; message: string }
  | { type: 'deleted'; modelId: string }
  | {
      type: 'status';
      loaded?: string;
      loading?: boolean;
      /** Last load progress (0..1) while loading. */
      p?: number;
      gpu: boolean;
      /** Weights for `modelId` (from the request) are in the browser cache. */
      cached?: boolean;
    };

/** The subset of `chrome.runtime.Port` the client needs (lets tests pass a fake). */
export interface PortLike {
  postMessage(msg: LlmRequest): void;
  onMessage: {
    addListener(cb: (msg: LlmEvent) => void): void;
    removeListener(cb: (msg: LlmEvent) => void): void;
  };
  onDisconnect: { addListener(cb: () => void): void; removeListener(cb: () => void): void };
  disconnect(): void;
}
