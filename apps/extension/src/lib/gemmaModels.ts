import models from './gemma-models.json';

export interface GemmaModel {
  /** WebLLM model id (key into `prebuiltAppConfig.model_list`). */
  id: string;
  tier: 'small' | 'balanced' | 'larger';
  label: string;
  /** File name under `public/models/` (bundled; see scripts/fetch-model-libs.mjs). */
  wasm: string;
  /** Approximate one-time weight download. */
  downloadGB: number;
  vramMB: number;
  contextTokens: number;
}

export const GEMMA_MODELS = models as GemmaModel[];
export const DEFAULT_GEMMA = 'gemma3-1b-it-q4f16_1-MLC';

export function gemmaById(id: string): GemmaModel | undefined {
  return GEMMA_MODELS.find((m) => m.id === id);
}
