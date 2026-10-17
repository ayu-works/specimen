import { MID_STREAM_TEXT, streamError, TRUNCATED_TEXT } from '../errors';
import { PRESETS, type Preset } from '../presets';
import type { ChatRequest, ContentPart, LLMProvider, ProviderConfig } from '../types';
import { ProviderError } from '../types';
import { CUT_SHORT_TEXT, FILTERED_TEXT, postSse, trimSlash } from './http';

/** Presets served by the OpenAI-compatible adapter (ARCHITECTURE §7). */
export const OPENAI_COMPAT_PRESETS: readonly Preset[] = PRESETS.filter((p) => p.kind === 'openai');
/** Finish reasons for a reply cut at a limit; Mistral says `model_length` when the context is full. */
const CUT_OFF = new Set(['length', 'model_length']);
/** Mistral's `error` and DeepSeek's `insufficient_system_resource` end a reply that failed on their side. */
const FAILED = new Set(['error', 'insufficient_system_resource']);

function toContent(content: string | ContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: p.dataUrl } },
  );
}

/** Exported so tests can check URL, headers and body without a network. */
export function buildOpenAIRequest(cfg: ProviderConfig, req: ChatRequest) {
  const messages: { role: string; content: unknown }[] = [];
  if (req.system) messages.push({ role: 'system', content: req.system });
  for (const m of req.messages) messages.push({ role: m.role, content: toContent(m.content) });
  const body: Record<string, unknown> = { model: cfg.model, messages, stream: true };
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.json) body.response_format = { type: 'json_object' };
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  return { url: `${trimSlash(cfg.baseUrl)}/chat/completions`, headers, body };
}

export function createOpenAICompat(
  cfg: ProviderConfig & { id?: string; needsKey?: boolean },
): LLMProvider {
  return {
    id: cfg.id ?? 'openai-compat',
    label: cfg.label ?? 'OpenAI-compatible',
    capabilities: {
      vision: cfg.vision ?? false,
      streaming: true,
      contextTokens: cfg.contextTokens ?? 32_000,
    },
    async status() {
      if (!cfg.baseUrl || !cfg.model)
        return { state: 'needs-setup', detail: 'Set a base URL and model' };
      if ((cfg.needsKey ?? true) && !cfg.apiKey)
        return { state: 'needs-setup', detail: 'Add an API key' };
      return { state: 'ready' };
    },
    async *chat(req, signal) {
      const { url, headers, body } = buildOpenAIRequest(cfg, req);
      // Local servers send `[DONE]` or a finish_reason, not always both; either one ends a whole reply.
      let finished = false;
      for await (const ev of postSse(url, headers, body, signal)) {
        if (ev.data === '[DONE]') return;
        let json: {
          choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
          error?: unknown;
        };
        try {
          json = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (json.error) throw streamError(json.error);
        const text = json.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text) yield text;
        // The last text can share the chunk with the finish reason, so it goes out first.
        const finish = json.choices?.[0]?.finish_reason;
        // Some servers (LocalAI) send `""` on every chunk until the real reason.
        if (finish == null || finish === '') continue;
        finished = true;
        const reason = String(finish);
        if (CUT_OFF.has(reason)) throw new ProviderError('other', TRUNCATED_TEXT);
        if (reason === 'content_filter') throw new ProviderError('other', FILTERED_TEXT);
        if (FAILED.has(reason)) throw new ProviderError('other', MID_STREAM_TEXT);
      }
      if (!finished) throw new ProviderError('other', CUT_SHORT_TEXT);
    },
  };
}
