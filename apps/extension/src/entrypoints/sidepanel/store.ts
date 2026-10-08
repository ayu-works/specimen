import type { DesignScan } from '@specimen/core/schema';
import { create } from 'zustand';

export type TabId = 'scan' | 'inspect' | 'generate' | 'ask' | 'library';
export type Status = 'idle' | 'scanning' | 'done' | 'error';

interface State {
  scan: DesignScan | null;
  screenshot: string | null;
  favicon: string | null;
  status: Status;
  error: string | null;
  activeTab: TabId;
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
  setTab: (activeTab) => set({ activeTab }),
  start: () => set({ status: 'scanning', error: null }),
  succeed: (scan, screenshot, favicon) =>
    set({ scan, screenshot, favicon, status: 'done', error: null }),
  fail: (error) => set({ status: 'error', error }),
}));
