import { httpError, mapThrown } from './errors';
import type { Preset } from './presets';
import { trimSlash } from './providers/http';

/** Model ids that cannot chat (speech, embeddings, images, moderation, guards). */
const NON_CHAT =
  /whisper|embed|tts|transcribe|audio|dall-e|image|moderation|guard|rerank|playai|vision-preview$/i;

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  try {
    const res = await fetch(url, { headers, credentials: 'omit' });
    if (!res.ok) throw await httpError(res);
    return await res.json();
  } catch (e) {
    throw mapThrown(e);
  }
}

/**
 * Ask the provider which chat models this key can use. Hard-coded defaults go stale (providers
 * retire models), so settings offer this live list instead of guessing.
 */
export async function listModels(
  preset: Preset,
  cfg: { baseUrl: string; apiKey?: string },
): Promise<string[]> {
  let ids: string[] = [];
  if (preset.kind === 'anthropic') {
    const body = (await getJson('https://api.anthropic.com/v1/models?limit=100', {
      'x-api-key': cfg.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    })) as { data?: { id: string }[] };
    ids = (body.data ?? []).map((m) => m.id);
  } else if (preset.kind === 'gemini') {
    const body = (await getJson(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { 'x-goog-api-key': cfg.apiKey ?? '' },
    )) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    ids = (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  } else {
    const headers: Record<string, string> = {};
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
    const body = (await getJson(`${trimSlash(cfg.baseUrl)}/models`, headers)) as {
      data?: { id: string }[];
    };
    ids = (body.data ?? []).map((m) => m.id);
  }
  return [...new Set(ids.filter((id) => !NON_CHAT.test(id)))].sort();
}

/** Pick a sensible default from a live list: the preset's model if offered, else the first. */
export function pickModel(models: string[], preferred?: string): string | undefined {
  if (preferred && models.includes(preferred)) return preferred;
  return models[0];
}
