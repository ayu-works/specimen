/**
 * Bring the panel back where the user left it (SPC-26). The scan comes from the Library, the Ask
 * history follows it (Ask.tsx loads it from the db), and the light UI state (which tab, which Ask
 * mode) lives in `chrome.storage.session`: in memory, this extension only, gone when the browser quits.
 */
import { scrubStoredChats } from '@/lib/chatScrub';
import { getStoredScan, latestScan, type StoredScan, scansForHost, thumbDataUrl } from '@/lib/db';
import { sameUrl } from '@/lib/scanFlow';
import { type AskMode, type TabId, useStore } from './store';

/** A saved scan of the same page older than this is not restored on its own. */
export const FRESH_MS = 24 * 60 * 60 * 1000;

/** What the panel remembers per window: ids and names only, no page text, chat or keys. */
export interface PanelMemo {
  scanId: string;
  activeTab: TabId;
  askMode: AskMode;
  at: number;
}

export const memoKey = (windowId: number) => `panel.last.${windowId}`;

async function readMemo(windowId: number): Promise<PanelMemo | null> {
  try {
    const got = await chrome.storage.session.get(memoKey(windowId));
    return (got[memoKey(windowId)] as PanelMemo | undefined) ?? null;
  } catch {
    return null;
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  try {
    return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  } catch {
    return undefined;
  }
}

/** The newest saved scan of this exact page within `maxAgeMs`, or null. */
export async function findRecentScan(
  url: string,
  now = Date.now(),
  maxAgeMs = FRESH_MS,
): Promise<StoredScan | null> {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  const rows = await scansForHost(host);
  return rows.find((s) => sameUrl(s.url, url) && now - s.scannedAt <= maxAgeMs) ?? null;
}

/** Nothing has happened in the panel yet (the user may have scanned while we looked). */
const untouched = () => {
  const s = useStore.getState();
  return s.scan === null && s.status === 'idle';
};

/**
 * Restore on panel open. Never throws: on any error the panel just opens empty, as before.
 * Returns the window id the panel belongs to (for `rememberPanel`), when known.
 */
export async function restorePanel(): Promise<number | undefined> {
  await scrubStoredChats();
  const tab = await activeTab();
  const windowId = tab?.windowId;
  try {
    const memo = windowId === undefined ? null : await readMemo(windowId);
    const url = tab?.url;
    if (!url) {
      // No site access yet, so the page is unknown: offer the last scan instead of applying it.
      const last = (memo && (await getStoredScan(memo.scanId))) || (await latestScan());
      if (last && untouched()) useStore.getState().setOffer({ scanId: last.id, host: last.host });
      return windowId;
    }
    let scan: StoredScan | null = null;
    let fromMemo = false;
    if (memo) {
      const s = await getStoredScan(memo.scanId);
      if (s && sameUrl(s.url, url)) {
        scan = s;
        fromMemo = true;
      }
    }
    scan ??= await findRecentScan(url);
    if (!scan) return windowId;
    const screenshot = await thumbDataUrl(scan.id).catch(() => null);
    if (!untouched()) return windowId;
    const st = useStore.getState();
    st.openScan(scan, 'tab', screenshot);
    // Same page as the active tab, so dark capture and "Add another page" can use it.
    if (tab?.id !== undefined) st.patchExtras({ tabId: tab.id });
    st.setTab(fromMemo && memo ? memo.activeTab : 'inspect');
    if (fromMemo && memo) st.setAskMode(memo.askMode);
  } catch {
    /* Library unavailable: start empty */
  }
  return windowId;
}

/** Open the offered last scan (the "Last scan" button on the Scan tab). */
export async function openOffer(): Promise<void> {
  const offer = useStore.getState().offer;
  if (!offer) return;
  const scan = await getStoredScan(offer.scanId).catch(() => null);
  if (!scan) {
    useStore.getState().setOffer(null);
    return;
  }
  const screenshot = await thumbDataUrl(scan.id).catch(() => null);
  useStore.getState().openScan(scan, 'saved', screenshot);
  useStore.getState().setTab('inspect');
}

/** Keep this window's memo current. Returns the unsubscribe. */
export function rememberPanel(windowId: number): () => void {
  let last = '';
  return useStore.subscribe((s) => {
    if (!s.scan) return;
    const memo: PanelMemo = {
      scanId: s.scan.id,
      activeTab: s.activeTab,
      askMode: s.askMode,
      at: Date.now(),
    };
    const sig = `${memo.scanId}|${memo.activeTab}|${memo.askMode}`;
    if (sig === last) return;
    last = sig;
    try {
      chrome.storage.session.set({ [memoKey(windowId)]: memo }).catch(() => {});
    } catch {
      /* no session storage: the next open restores by URL only */
    }
  });
}
