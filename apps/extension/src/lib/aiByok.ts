import {
  createAnthropic,
  createGemini,
  createOpenAICompat,
  type LLMProvider,
  type Preset,
} from '@specimen/ai';

/** Build a BYOK provider from a preset plus the user's values. Never logs or stores the key. */
export function resolveByokProvider(
  preset: Preset,
  v: { baseUrl: string; model: string; apiKey?: string; vision: boolean },
): LLMProvider {
  const cfg = {
    baseUrl: v.baseUrl,
    model: v.model,
    apiKey: v.apiKey,
    vision: v.vision,
    contextTokens: preset.contextTokens,
    label: preset.label.split(' (')[0],
  };
  if (preset.kind === 'anthropic') return createAnthropic({ ...cfg, label: 'Claude' });
  if (preset.kind === 'gemini') return createGemini({ ...cfg, label: 'Gemini' });
  return createOpenAICompat({ ...cfg, id: preset.id, needsKey: preset.needsKey });
}
