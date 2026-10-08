import {
  createChromeBuiltin,
  createWebLLMProvider,
  getPreset,
  isChromeBuiltinAvailable,
  type LLMProvider,
  WebLLMClient,
} from '@specimen/ai';
import { useCallback, useEffect, useState } from 'react';
import { resolveByokProvider } from './aiByok';
import { type AiSettings, loadAiSettings, loadKey, presetBase, watchAi } from './aiSettings';
import { gemmaById } from './gemmaModels';
import { send } from './messaging';

export type AiState = 'off' | 'ready' | 'needs-setup' | 'locked' | 'loading' | 'error';

export interface ResolvedAi {
  provider: LLMProvider | null;
  state: AiState;
  /** Short chip text, e.g. "Gemma ready". */
  label: string;
  detail?: string;
  /** Preset id when the key is encrypted and locked. */
  lockedPreset?: string;
}

export const SETUP_HINT = 'Set up AI in Settings';

const OFF: ResolvedAi = { provider: null, state: 'off', label: 'AI off' };

export const ensureOffscreen = async (): Promise<void> => {
  await send('offscreen.ensure', {});
};

async function offscreenExists(): Promise<boolean> {
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return ctx.length > 0;
  } catch {
    return false;
  }
}

async function resolveWebllm(s: AiSettings): Promise<ResolvedAi> {
  const model = gemmaById(s.webllmModel);
  if (!model) return { provider: null, state: 'needs-setup', label: 'AI: pick a model' };
  const provider = createWebLLMProvider({
    modelId: model.id,
    contextTokens: model.contextTokens,
    ensure: ensureOffscreen,
  });
  const downloaded = s.downloaded.includes(model.id);
  // Don't spin up the offscreen document just to draw a chip.
  if (!(await offscreenExists())) {
    return downloaded
      ? { provider, state: 'ready', label: 'AI: Gemma ready', detail: 'Loads on first use' }
      : { provider: null, state: 'needs-setup', label: 'AI: Gemma not downloaded' };
  }
  try {
    const st = await new WebLLMClient(undefined).status(model.id);
    if (!st.gpu) {
      return {
        provider: null,
        state: 'error',
        label: 'AI: no WebGPU',
        detail: 'WebGPU is not available',
      };
    }
    if (st.loaded === model.id) return { provider, state: 'ready', label: 'AI: Gemma ready' };
    if (st.loading) return { provider: null, state: 'loading', label: 'AI: Gemma loading…' };
    if (st.cached)
      return { provider, state: 'ready', label: 'AI: Gemma ready', detail: 'Loads on first use' };
    return { provider: null, state: 'needs-setup', label: 'AI: Gemma not downloaded' };
  } catch {
    return downloaded
      ? { provider, state: 'ready', label: 'AI: Gemma ready', detail: 'Loads on first use' }
      : { provider: null, state: 'needs-setup', label: 'AI: Gemma not downloaded' };
  }
}

async function resolveByok(s: AiSettings): Promise<ResolvedAi> {
  const preset = getPreset(s.byok.preset);
  if (!preset) return { provider: null, state: 'needs-setup', label: 'AI: pick a provider' };
  const baseUrl = presetBase(preset.id, s.byok.baseUrl);
  const model = s.byok.model || preset.model;
  let apiKey: string | undefined;
  if (preset.needsKey) {
    const k = await loadKey(preset.id);
    if (k.status === 'none') {
      return { provider: null, state: 'needs-setup', label: 'AI: add a key', detail: SETUP_HINT };
    }
    if (k.status === 'locked') {
      return { provider: null, state: 'locked', label: 'AI: locked', lockedPreset: preset.id };
    }
    apiKey = k.key;
  }
  if (!baseUrl || !model)
    return { provider: null, state: 'needs-setup', label: 'AI: finish setup' };
  const provider = resolveByokProvider(preset, {
    baseUrl,
    model,
    apiKey,
    vision: s.byok.vision ?? preset.vision,
  });
  const label =
    preset.kind === 'anthropic'
      ? 'Claude'
      : preset.kind === 'gemini'
        ? 'Gemini'
        : preset.label.split(' (')[0];
  return { provider, state: 'ready', label: `AI: ${label}` };
}

export async function resolveAi(): Promise<ResolvedAi> {
  // Test hook: lets component/e2e tests inject a mock provider.
  const injected = (globalThis as { __specimenProvider?: LLMProvider }).__specimenProvider;
  if (injected) return { provider: injected, state: 'ready', label: `AI: ${injected.label}` };

  const s = await loadAiSettings();
  switch (s.provider) {
    case 'webllm':
      return resolveWebllm(s);
    case 'byok':
      return resolveByok(s);
    case 'chrome': {
      if (!(await isChromeBuiltinAvailable())) {
        return { provider: null, state: 'error', label: 'AI: Chrome model unavailable' };
      }
      return { provider: createChromeBuiltin(), state: 'ready', label: 'AI: Chrome' };
    }
    default:
      return OFF;
  }
}

/** React hook: the resolved provider, refreshed when settings, keys or the model state change. */
export function useAi(): ResolvedAi & { refresh: () => void } {
  const [ai, setAi] = useState<ResolvedAi>(OFF);
  // Polling must not swap the provider object (and re-trigger consumers) unless something changed;
  // settings/key changes always do, because the provider closes over the key.
  const refresh = useCallback((force = true) => {
    void resolveAi().then(
      (next) =>
        setAi((prev) =>
          !force &&
          prev.state === next.state &&
          prev.label === next.label &&
          prev.detail === next.detail
            ? prev
            : next,
        ),
      () => setAi({ ...OFF, state: 'error', label: 'AI: error' }),
    );
  }, []);

  useEffect(() => {
    refresh();
    const stop = watchAi(() => refresh(true));
    // The local model loads/unloads outside this page, so poll its state lightly.
    const timer = setInterval(() => refresh(false), 5000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [refresh]);

  return { ...ai, refresh: () => refresh(true) };
}
