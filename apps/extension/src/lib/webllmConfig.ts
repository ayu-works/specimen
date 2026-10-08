import { type AppConfig, prebuiltAppConfig } from '@mlc-ai/web-llm';
import { GEMMA_MODELS } from './gemmaModels';

/**
 * WebLLM app config restricted to the Gemma options we offer. `model_lib` points at the `.wasm`
 * bundled inside the extension (never a remote URL: Chrome Web Store forbids remotely hosted
 * executable code). Only the model weights are downloaded at runtime.
 */
export function buildAppConfig(): AppConfig {
  const model_list = GEMMA_MODELS.flatMap((m) => {
    const rec = prebuiltAppConfig.model_list.find((r) => r.model_id === m.id);
    if (!rec) return [];
    return [{ ...rec, model_lib: chrome.runtime.getURL(`/models/${m.wasm}`) }];
  });
  return { model_list };
}
