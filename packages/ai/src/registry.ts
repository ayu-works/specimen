import type { LLMProvider } from './types';

const providers = new Map<string, LLMProvider>();
let activeId: string | null = null;

/** Add or replace a provider. The active provider stays unset: the default is none. */
export function registerProvider(p: LLMProvider): void {
  providers.set(p.id, p);
}

export function getProvider(id: string): LLMProvider | undefined {
  return providers.get(id);
}

export function listProviders(): LLMProvider[] {
  return [...providers.values()];
}

export function unregisterProvider(id: string): void {
  providers.delete(id);
  if (activeId === id) activeId = null;
}

/** Choose the provider features use; `null` means AI is off. */
export function setActiveProvider(id: string | null): void {
  activeId = id !== null && providers.has(id) ? id : null;
}

export function getActiveProvider(): LLMProvider | null {
  return activeId ? (providers.get(activeId) ?? null) : null;
}

export function clearProviders(): void {
  providers.clear();
  activeId = null;
}
