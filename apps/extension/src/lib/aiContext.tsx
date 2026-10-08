import { createContext, type ReactNode, useContext } from 'react';
import { type ResolvedAi, useAi } from './aiRuntime';

type Ctx = ResolvedAi & { refresh: () => void };
const AiContext = createContext<Ctx | null>(null);

/** One resolver (and one poll timer) shared by the header chip and every AI feature. */
export function AiProvider({ children }: { children: ReactNode }) {
  const ai = useAi();
  return <AiContext.Provider value={ai}>{children}</AiContext.Provider>;
}

export function useAiContext(): Ctx {
  const c = useContext(AiContext);
  if (!c) throw new Error('useAiContext outside AiProvider');
  return c;
}

export function openSettings(): void {
  try {
    void chrome.runtime.openOptionsPage();
  } catch {
    /* not available outside the extension */
  }
}
