import { parseDataUrl } from '../dataUrl';
import { streamError, TRUNCATED_TEXT } from '../errors';
import type { ChatRequest, ContentPart, LLMProvider, ProviderConfig } from '../types';
import { ProviderError } from '../types';
import { CUT_SHORT_TEXT, FILTERED_TEXT, postSse, trimSlash } from './http';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
/** Finish reasons for a reply stopped by a safety, recitation or blocklist filter. */
const FILTERED = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
]);

function toParts(content: string | ContentPart[]): unknown[] {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((p) => {
    if (p.type === 'text') return { text: p.text };
    const { mediaType, base64 } = parseDataUrl(p.dataUrl);
    return { inline_data: { mime_type: mediaType, data: base64 } };
  });
}

export function buildGeminiRequest(cfg: ProviderConfig, req: ChatRequest) {
  const generationConfig: Record<string, unknown> = {};
  if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.json) generationConfig.responseMimeType = 'application/json';
  const body: Record<string, unknown> = {
    contents: req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: toParts(m.content),
    })),
  };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  const model = encodeURIComponent(cfg.model || GEMINI_DEFAULT_MODEL);
  return {
    // The key travels in a header, never in the URL.
    url: `${trimSlash(cfg.baseUrl || GEMINI_BASE_URL)}/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    headers: { 'x-goog-api-key': cfg.apiKey ?? '' },
    body,
  };
}

export function createGemini(cfg: ProviderConfig): LLMProvider {
  return {
    id: 'gemini',
    label: cfg.label ?? 'Gemini',
    capabilities: {
      vision: cfg.vision ?? true,
      streaming: true,
      contextTokens: cfg.contextTokens ?? 1_000_000,
    },
    async status() {
      return cfg.apiKey ? { state: 'ready' } : { state: 'needs-setup', detail: 'Add an API key' };
    },
    async *chat(req, signal) {
      const { url, headers, body } = buildGeminiRequest(cfg, req);
      let finished = false;
      for await (const ev of postSse(url, headers, body, signal)) {
        let json: {
          candidates?: { content?: { parts?: { text?: unknown }[] }; finishReason?: unknown }[];
          promptFeedback?: { blockReason?: unknown };
          error?: unknown;
        };
        try {
          json = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (json.error) throw streamError(json.error);
        // A blocked prompt gets no candidates, only this.
        if (json.promptFeedback?.blockReason) throw new ProviderError('other', FILTERED_TEXT);
        for (const part of json.candidates?.[0]?.content?.parts ?? []) {
          if (typeof part.text === 'string' && part.text) yield part.text;
        }
        // The chunk's own text is out before any throw, and nothing after a throw is read.
        const finish = json.candidates?.[0]?.finishReason;
        if (typeof finish !== 'string' || !finish) continue;
        if (finish === 'MAX_TOKENS') throw new ProviderError('other', TRUNCATED_TEXT);
        if (FILTERED.has(finish)) throw new ProviderError('other', FILTERED_TEXT);
        finished = true;
      }
      // Gemini always sends a finishReason on its last chunk; without one the reply was cut off.
      if (!finished) throw new ProviderError('other', CUT_SHORT_TEXT);
    },
  };
}
