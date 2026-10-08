export interface LLMProvider {
  id: string;
  label: string;
  capabilities: { vision: boolean; streaming: boolean; contextTokens: number };
  status(): Promise<{
    state: 'ready' | 'needs-setup' | 'downloading' | 'error';
    detail?: string;
    progress?: number;
  }>;
  /** Yields text deltas. */
  chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<string>;
}

export interface ChatRequest {
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string | ContentPart[] }[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; dataUrl: string };

export type ProviderErrorKind = 'auth' | 'rate' | 'network' | 'unsupported' | 'aborted' | 'other';

/** Every adapter throws this (never a raw fetch/HTTP error) so the UI can show a friendly message. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  constructor(kind: ProviderErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderError';
    this.kind = kind;
  }
}

/** Connection settings for a BYOK / OpenAI-compatible provider. Never log this object (apiKey). */
export interface ProviderConfig {
  /** Base URL without a trailing slash, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Display name, e.g. "Claude". */
  label?: string;
  /** Whether the chosen model accepts images. */
  vision?: boolean;
  contextTokens?: number;
}
