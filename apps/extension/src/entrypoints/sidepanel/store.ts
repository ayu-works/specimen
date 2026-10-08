import type { DesignScan } from '@specimen/core/schema';
import { create } from 'zustand';
import type { ChatMessage } from '@/lib/db';

export type AskMessage = ChatMessage;

export type TabId = 'scan' | 'inspect' | 'generate' | 'ask' | 'library';
/** Where the current scan came from: the live tab, a saved Library entry, or a Compose mix. */
export type Origin = 'tab' | 'saved' | 'composed';
export type Status = 'idle' | 'scanning' | 'done' | 'error';

interface State {
  scan: DesignScan | null;
  screenshot: string | null;
  favicon: string | null;
  status: Status;
  error: string | null;
  activeTab: TabId;
  origin: Origin;
  /** Ask-view history, per scan id (persisted to the Library db when the scan is saved). */
  chats: Record<string, AskMessage[]>;
  setChat: (scanId: string, update: (prev: AskMessage[]) => AskMessage[]) => void;
  /** Store the AI vibe on the current scan so the prompt generator picks it up. */
  setVibe: (vibe: NonNullable<DesignScan['vibe']>) => void;
  setTab: (t: TabId) => void;
  /** Make a Library / composed scan the current one. */
  openScan: (scan: DesignScan, origin: Origin, screenshot?: string | null) => void;
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
  origin: 'tab',
  chats: {},
  setChat: (scanId, update) =>
    set((s) => ({ chats: { ...s.chats, [scanId]: update(s.chats[scanId] ?? []) } })),
  setVibe: (vibe) => set((s) => (s.scan ? { scan: { ...s.scan, vibe } } : {})),
  setTab: (activeTab) => set({ activeTab }),
  openScan: (scan, origin, screenshot = null) =>
    set({ scan, origin, screenshot, favicon: null, status: 'done', error: null }),
  start: () => set({ status: 'scanning', error: null }),
  succeed: (scan, screenshot, favicon) =>
    set({ scan, origin: 'tab', screenshot, favicon, status: 'done', error: null }),
  fail: (error) => set({ status: 'error', error }),
}));
