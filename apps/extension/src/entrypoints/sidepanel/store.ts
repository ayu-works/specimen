import type { DesignScan, RawHints } from '@specimen/core/schema';
import { create } from 'zustand';
import type { ChatMessage } from '@/lib/db';

export type AskMessage = ChatMessage;

export type TabId = 'scan' | 'inspect' | 'generate' | 'ask' | 'library';
/** Where the current scan came from: the live tab, a saved Library entry, or a Compose mix. */
export type Origin = 'tab' | 'saved' | 'composed';
export type Status = 'idle' | 'scanning' | 'done' | 'error';

/** Secondary captures that follow a scan (mobile, other color scheme, extra pages). */
export interface Extras {
  /** The scan these states belong to. */
  scanId: string | null;
  /** The tab that was scanned; dark capture and "Add another page" use it. */
  tabId: number | null;
  hints: RawHints | null;
  /** `wide` = Chrome kept the popup wider than a phone and the debugger permission isn't held. */
  mobile: 'idle' | 'running' | 'done' | 'failed' | 'wide';
  /** `offer` = the page only reacts to the OS setting: needs the one-time debugger permission. */
  theme: 'idle' | 'running' | 'measured' | 'none' | 'offer' | 'failed';
  page: 'idle' | 'running';
  /** Short plain-language note for the last failure or result. */
  note: string | null;
}

export const NO_EXTRAS: Extras = {
  scanId: null,
  tabId: null,
  hints: null,
  mobile: 'idle',
  theme: 'idle',
  page: 'idle',
  note: null,
};

interface State {
  scan: DesignScan | null;
  screenshot: string | null;
  favicon: string | null;
  status: Status;
  error: string | null;
  activeTab: TabId;
  origin: Origin;
  extras: Extras;
  /** Set by Library's "Check a build against this"; Generate scrolls to its check card once. */
  checkPending: boolean;
  /** Ask-view history, per scan id (persisted to the Library db when the scan is saved). */
  chats: Record<string, AskMessage[]>;
  setChat: (scanId: string, update: (prev: AskMessage[]) => AskMessage[]) => void;
  /** Store the AI vibe on the current scan so the prompt generator picks it up. */
  setVibe: (vibe: NonNullable<DesignScan['vibe']>) => void;
  /** Replace the current scan with an updated version of itself (variants, merged pages). */
  setScan: (scan: DesignScan) => void;
  patchExtras: (patch: Partial<Extras>) => void;
  requestCheck: () => void;
  clearCheck: () => void;
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
  extras: NO_EXTRAS,
  checkPending: false,
  chats: {},
  setChat: (scanId, update) =>
    set((s) => ({ chats: { ...s.chats, [scanId]: update(s.chats[scanId] ?? []) } })),
  setVibe: (vibe) => set((s) => (s.scan ? { scan: { ...s.scan, vibe } } : {})),
  setScan: (scan) => set((s) => (s.scan?.id === scan.id ? { scan } : {})),
  patchExtras: (patch) => set((s) => ({ extras: { ...s.extras, ...patch } })),
  requestCheck: () => set({ checkPending: true }),
  clearCheck: () => set({ checkPending: false }),
  setTab: (activeTab) => set({ activeTab }),
  openScan: (scan, origin, screenshot = null) =>
    set({
      scan,
      origin,
      screenshot,
      favicon: null,
      status: 'done',
      error: null,
      extras: { ...NO_EXTRAS, scanId: scan.id },
    }),
  start: () => set({ status: 'scanning', error: null }),
  succeed: (scan, screenshot, favicon) =>
    set({
      scan,
      origin: 'tab',
      screenshot,
      favicon,
      status: 'done',
      error: null,
      extras: { ...NO_EXTRAS, scanId: scan.id },
    }),
  fail: (error) => set({ status: 'error', error }),
}));
