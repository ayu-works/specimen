import { PRESETS, type Preset } from '../presets';
import type { ChatRequest, ContentPart, LLMProvider, ProviderConfig } from '../types';
import { postSse, trimSlash } from './http';

/** Presets served by the OpenAI-compatible adapter (ARCHITECTURE §7). */
export const OPENAI_COMPAT_PRESETS: readonly Preset[] = PRESETS.filter((p) => p.kind === 'openai');

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
      for await (const ev of postSse(url, headers, body, signal)) {
        if (ev.data === '[DONE]') return;
        let json: { choices?: { delta?: { content?: unknown } }[] };
        try {
          json = JSON.parse(ev.data);
        } catch {
          continue;
        }
        const text = json.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text) yield text;
      }
    },
  };
}
