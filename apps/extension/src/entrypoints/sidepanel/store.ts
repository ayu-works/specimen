import type { DesignScan } from '@specimen/core/schema';
import { create } from 'zustand';

export interface AskMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Friendly error text instead of an answer. */
  error?: string;
}

export type TabId = 'scan' | 'inspect' | 'generate' | 'ask' | 'library';
export type Status = 'idle' | 'scanning' | 'done' | 'error';

interface State {
  scan: DesignScan | null;
  screenshot: string | null;
  favicon: string | null;
  status: Status;
  error: string | null;
  activeTab: TabId;
  /** Ask-view history, per scan id (persistence arrives with the Library). */
  chats: Record<string, AskMessage[]>;
  setChat: (scanId: string, update: (prev: AskMessage[]) => AskMessage[]) => void;
  /** Store the AI vibe on the current scan so the prompt generator picks it up. */
  setVibe: (vibe: NonNullable<DesignScan['vibe']>) => void;
  setTab: (t: TabId) => void;
  start: () => void;
  succeed: (scan: DesignScan, screenshot: string | null, favicon: string | null) => void;
  fail: (message: string) => void;
}

export const useStore = create<State>((set) => ({
  scan: null,
  screenshot: null,
  favicon: null,
  status: 'idle',
  error: null,
  activeTab: 'scan',
  chats: {},
  setChat: (scanId, update) =>
    set((s) => ({ chats: { ...s.chats, [scanId]: update(s.chats[scanId] ?? []) } })),
  setVibe: (vibe) => set((s) => (s.scan ? { scan: { ...s.scan, vibe } } : {})),
  setTab: (activeTab) => set({ activeTab }),
  start: () => set({ status: 'scanning', error: null }),
  succeed: (scan, screenshot, favicon) =>
    set({ scan, screenshot, favicon, status: 'done', error: null }),
  fail: (error) => set({ status: 'error', error }),
}));
