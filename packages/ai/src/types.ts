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
