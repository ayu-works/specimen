import {
  type CritiqueTurn,
  DEFAULT_PERSONAS,
  type KeepChange,
  type LLMProvider,
  type PersonaId,
  runCritique,
} from '@specimen/ai';
import type { DesignScan } from '@specimen/core/schema';
import { create } from 'zustand';
import { useStore } from '../store';

export type Phase = 'setup' | 'running' | 'done' | 'stopped' | 'error';

interface CritiqueState {
  /** The scan the transcript belongs to. */
  scanId: string | null;
  phase: Phase;
  personas: PersonaId[];
  rounds: number;
  turns: CritiqueTurn[];
  /** Human messages waiting for the next turn. */
  queued: string[];
  summary: KeepChange | null;
  error: string | null;
  /** The provider the current/last run sends to (the UI shows its label, not the current one). */
  runProvider: LLMProvider | null;
  setPersonas: (p: PersonaId[]) => void;
  setRounds: (n: number) => void;
  start: (provider: LLMProvider, scan: DesignScan) => Promise<void>;
  stop: () => void;
  send: (text: string) => void;
  /** Abort any run and clear the transcript (keeps the persona/round choice). */
  reset: (scanId?: string | null) => void;
}

/** One run at a time; module-level so switching tabs (which unmounts the view) keeps it alive. */
let controller: AbortController | null = null;

export const useCritique = create<CritiqueState>((set, get) => ({
  scanId: null,
  phase: 'setup',
  personas: DEFAULT_PERSONAS,
  rounds: 2,
  turns: [],
  queued: [],
  summary: null,
  error: null,
  runProvider: null,
  setPersonas: (personas) => set({ personas }),
  setRounds: (rounds) => set({ rounds }),
  start: async (provider, scan) => {
    if (controller) return;
    const ctl = new AbortController();
    controller = ctl;
    set({
      scanId: scan.id,
      phase: 'running',
      turns: [],
      queued: [],
      summary: null,
      error: null,
      runProvider: provider,
    });
    const { personas, rounds } = get();
    const r = await runCritique(provider, scan, {
      personas,
      rounds,
      signal: ctl.signal,
      onTurn: (i, t) => {
        if (controller !== ctl) return;
        set((s) => {
          const turns = [...s.turns];
          turns[i] = t;
          return { turns };
        });
      },
      takeHuman: () => {
        if (controller !== ctl) return [];
        const q = get().queued;
        set({ queued: [] });
        return q;
      },
    });
    // A reset (new scan) already cleared the state; ignore the late result.
    if (controller !== ctl) return;
    controller = null;
    set({ phase: r.status, turns: r.turns, summary: r.summary, error: r.error ?? null });
  },
  stop: () => controller?.abort(),
  send: (text) => {
    const t = text.trim();
    if (t && get().phase === 'running') set((s) => ({ queued: [...s.queued, t] }));
  },
  reset: (scanId = null) => {
    controller?.abort();
    controller = null;
    set({
      scanId,
      phase: 'setup',
      turns: [],
      queued: [],
      summary: null,
      error: null,
      runProvider: null,
    });
  },
}));

/**
 * Stop a run when the chosen provider changes: a new key, preset or provider means page data
 * must not keep going to the old one. A local model that only reloads (same `webllm` id) sends
 * nothing off the device, so its state changes don't stop the run.
 */
export function guardProvider(current: LLMProvider | null): void {
  const { phase, runProvider, stop } = useCritique.getState();
  if (phase !== 'running' || !runProvider || current === runProvider) return;
  if (runProvider.id === 'webllm' && current?.id === 'webllm') return;
  stop();
}

// A different scan (new scan, Library, Compose) aborts the run: its transcript no longer applies.
useStore.subscribe((s, prev) => {
  if (s.scan?.id === prev.scan?.id) return;
  const c = useCritique.getState();
  if (c.scanId && c.scanId !== s.scan?.id) c.reset(null);
});
