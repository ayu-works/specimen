/**
 * Bring the panel back where the user left it (SPC-26). The scan comes from the Library, the Ask
 * history follows it (Ask.tsx loads it from the db), and the light UI state (which tab, which Ask
 * mode) lives in `chrome.storage.session`: in memory, this extension only, gone when the browser quits.
 */
import { startChatScrub } from '@/lib/chatScrub';
import { getStoredScan, latestScan, type StoredScan, scansForHost, thumbDataUrl } from '@/lib/db';
import { sameUrl } from '@/lib/scanFlow';
import { type AskMode, type Origin, type TabId, useStore } from './store';

/** A saved scan older than this is never restored on its own (memo or Library lookup). */
export const FRESH_MS = 24 * 60 * 60 * 1000;

/** What the panel remembers per window: ids and names only, no page text, chat or keys. */
export interface PanelMemo {
  scanId: string;
  /** Where the scan came from; only a `'tab'` scan is reattached to the live tab. */
  origin: Origin;
  activeTab: TabId;
  askMode: AskMode;
  at: number;
}

const TAB_IDS: readonly TabId[] = ['scan', 'inspect', 'generate', 'ask', 'library'];
const ASK_MODES: readonly AskMode[] = ['quick', 'council'];
const ORIGINS: readonly Origin[] = ['tab', 'saved', 'composed'];

/** A memo from another build (renamed tab, missing field) is ignored rather than trusted. */
function validMemo(v: unknown): PanelMemo | null {
  const m = v as Partial<PanelMemo> | null | undefined;
  if (!m || typeof m.scanId !== 'string') return null;
  if (!TAB_IDS.includes(m.activeTab as TabId) || !ASK_MODES.includes(m.askMode as AskMode))
    return null;
  if (!ORIGINS.includes(m.origin as Origin) || typeof m.at !== 'number') return null;
  return m as PanelMemo;
}

export const memoKey = (windowId: number) => `panel.last.${windowId}`;

async function readMemo(windowId: number): Promise<PanelMemo | null> {
  try {
    const got = await chrome.storage.session.get(memoKey(windowId));
    return validMemo(got[memoKey(windowId)]);
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
  await startChatScrub();
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
      // The memo can outlive a day (session storage lasts as long as the browser): same freshness rule.
      if (s && sameUrl(s.url, url) && Date.now() - s.scannedAt <= FRESH_MS) {
        scan = s;
        fromMemo = true;
      }
    }
    scan ??= await findRecentScan(url);
    if (!scan) return windowId;
    const screenshot = await thumbDataUrl(scan.id).catch(() => null);
    if (!untouched()) return windowId;
    const st = useStore.getState();
    // A Library or composed scan keeps its origin (banner shown, live captures off); only a tab scan
    // of this page is reattached to the tab, so dark capture and "Add another page" can use it.
    const origin: Origin = fromMemo && memo ? memo.origin : 'tab';
    st.openScan(scan, origin, screenshot);
    if (origin === 'tab' && tab?.id !== undefined) st.patchExtras({ tabId: tab.id });
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

/**
 * Keep this window's memo current. Writes the current state right away (a scan made while the
 * restore was still running counts too), then on every change. Returns the unsubscribe.
 */
export function rememberPanel(windowId: number): () => void {
  let last = '';
  const write = (s: ReturnType<typeof useStore.getState>) => {
    if (!s.scan) return;
    const memo: PanelMemo = {
      scanId: s.scan.id,
      origin: s.origin,
      activeTab: s.activeTab,
      askMode: s.askMode,
      at: Date.now(),
    };
    const sig = `${memo.scanId}|${memo.origin}|${memo.activeTab}|${memo.askMode}`;
    if (sig === last) return;
    last = sig;
    try {
      chrome.storage.session.set({ [memoKey(windowId)]: memo }).catch(() => {});
    } catch {
      /* no session storage: the next open restores by URL only */
    }
  };
  write(useStore.getState());
  return useStore.subscribe(write);
}
