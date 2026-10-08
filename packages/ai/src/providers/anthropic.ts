import { parseDataUrl } from '../dataUrl';
import type { ChatRequest, ContentPart, LLMProvider, ProviderConfig } from '../types';
import { ProviderError } from '../types';
import { postSse, trimSlash } from './http';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_MAX_TOKENS = 2048;

function toContent(content: string | ContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((p) => {
    if (p.type === 'text') return { type: 'text', text: p.text };
    const { mediaType, base64 } = parseDataUrl(p.dataUrl);
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
  });
}

export function buildAnthropicRequest(cfg: ProviderConfig, req: ChatRequest) {
  const system = [
    req.system,
    req.json ? 'Respond with a single valid JSON object and nothing else.' : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const body: Record<string, unknown> = {
    model: cfg.model || ANTHROPIC_DEFAULT_MODEL,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: true,
    messages: req.messages.map((m) => ({ role: m.role, content: toContent(m.content) })),
  };
  if (system) body.system = system;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  return {
    url: `${trimSlash(cfg.baseUrl || ANTHROPIC_BASE_URL)}/v1/messages`,
    headers: {
      'x-api-key': cfg.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body,
  };
}

export function createAnthropic(cfg: ProviderConfig): LLMProvider {
  return {
    id: 'anthropic',
    label: cfg.label ?? 'Claude',
    capabilities: {
      vision: cfg.vision ?? true,
      streaming: true,
      contextTokens: cfg.contextTokens ?? 200_000,
    },
    async status() {
      return cfg.apiKey ? { state: 'ready' } : { state: 'needs-setup', detail: 'Add an API key' };
    },
    async *chat(req, signal) {
      const { url, headers, body } = buildAnthropicRequest(cfg, req);
      for await (const ev of postSse(url, headers, body, signal)) {
        let json: {
          type?: string;
          delta?: { type?: string; text?: unknown };
          error?: { message?: unknown };
        };
        try {
          json = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (json.type === 'error') {
          throw new ProviderError(
            'other',
            String(json.error?.message ?? 'The provider reported an error'),
          );
        }
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          const t = json.delta.text;
          if (typeof t === 'string' && t) yield t;
        }
        if (json.type === 'message_stop') return;
      }
    },
  };
}
