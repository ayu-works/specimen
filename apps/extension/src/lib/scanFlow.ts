import { extract } from '@specimen/core';
import type { DesignScan, RawPage } from '@specimen/core/schema';
import { libraryErrorText, saveScan } from './db';
import { send } from './messaging';

const SITE_ACCESS =
  'Specimen needs permission to read the page you scan. Click Scan again and choose Allow.';

/** Turn a scan error (ours or Chrome's) into a sentence the panel can show. */
export function friendlyScanError(msg: string): string {
  const page = /^Unsupported page: (.*)$/.exec(msg)?.[1];
  // Judge an unsupported page by its scheme only: a file path may contain any word.
  if (page !== undefined && !/^chrome(-extension)?:\/\//i.test(page))
    return 'Specimen can only scan websites (http or https). Open one and try again.';
  if (page !== undefined || /chrome:\/\/|chrome-extension:\/\/|extensions gallery/i.test(msg))
    return "Can't scan chrome:// pages or the Chrome Web Store. Open a regular website and try again.";
  if (/No active tab/.test(msg)) return 'No active tab to scan.';
  if (/declined|user gesture|Cannot access contents|Missing host permission/i.test(msg))
    return SITE_ACCESS;
  if (/No tab with id|tab was closed/i.test(msg))
    return 'The tab was closed before the scan finished.';
  if (/took too long to load/i.test(msg))
    return 'The page took too long to load. Check the address or your connection and try again.';
  if (
    /Receiving end does not exist|Could not establish connection|no response for|message (port|channel) closed/i.test(
      msg,
    )
  )
    return "Specimen's background worker stopped. Click Scan again.";
  if (/showing error page/i.test(msg)) return "This page didn't load. Reload it and scan again.";
  if (/sampler returned no result/.test(msg))
    return "Couldn't read this page. Reload it and scan again.";
  return `Scan failed: ${msg}`;
}

/**
 * Opening the side panel from the toolbar does not grant `activeTab`, so the first scan asks
 * for the optional site access declared in the manifest. Must run inside the click gesture.
 */
export async function ensureSiteAccess(): Promise<void> {
  const origins = ['<all_urls>'];
  if (await chrome.permissions.contains({ origins })) return;
  if (!(await chrome.permissions.request({ origins }))) throw new Error('Site access declined');
}

export interface ScanOutcome {
  scan: DesignScan;
  screenshot: string;
  /** Page facts from the sampler (theme switches, menu button). */
  hints?: RawPage['hints'];
  /** Why the Library save failed (the scan itself is fine), or null when it was saved or not asked for. */
  saveError: string | null;
}

export interface ScanTabOptions {
  /** Save to the library (default true). Off for builds and extra pages. */
  save?: boolean;
  /** Skip the thumbnail. */
  noScreenshot?: boolean;
  /** Once aborted, a scan that answers late is dropped (never saved) and rejects with the reason. */
  signal?: AbortSignal;
}

/**
 * Scan a tab and save the result (with thumbnail) to the library. A failed save never fails the
 * scan; it comes back as `saveError` so the panel can say so.
 */
export async function scanTab(tabId: number, opts: ScanTabOptions = {}): Promise<ScanOutcome> {
  const res = await send('scan.run', {
    tabId,
    opts: opts.noScreenshot ? { noScreenshot: true } : undefined,
  });
  if (opts.signal?.aborted) throw opts.signal.reason;
  const scan = extract(res.raw);
  let saveError: string | null = null;
  if (opts.save !== false) {
    try {
      await saveScan(scan, res.screenshot);
    } catch (e) {
      saveError = libraryErrorText(e);
    }
  }
  return { scan, screenshot: res.screenshot, hints: res.raw.hints, saveError };
}

type TabLoadState = Pick<chrome.tabs.Tab, 'status' | 'url' | 'pendingUrl'>;

export interface TabLoadOptions {
  /** The url the tab was opened on: when we may read it, a hidden url means still about:blank. */
  url?: string;
  timeoutMs?: number;
  recheckMs?: number;
  /**
   * At the timeout, resolve instead of rejecting when the last state seen shows the navigation
   * committed to a page we can see for at least `COMMITTED_MIN_MS` (still `loading`, e.g. a slow
   * ad or iframe): scan what's there.
   */
  scanIfCommitted?: boolean;
}

/** Whether Chrome shows us `url` in `Tab.url` (no `tabs` permission: only with host access). */
async function urlVisible(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    return await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] });
  } catch {
    return false;
  }
}

/** Hidden or blank `complete` reads after a pending navigation before we stop waiting (~2 s). */
const ABANDONED_READS = 4;

/** How long a page must have shown as committed before the timeout scans it as it is. */
const COMMITTED_MIN_MS = 5000;

/**
 * Resolve when the tab finishes loading; reject on timeout or when it is closed. The listener can
 * miss a `complete` that Chrome sent before it was registered, so the tab is also re-read until
 * it settles (each read waits for the previous answer).
 */
export function waitForTabLoad(id: number, opts: TabLoadOptions = {}): Promise<void> {
  const { timeoutMs = 30000, recheckMs = 500 } = opts;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let recheck: ReturnType<typeof setTimeout> | undefined;
    // Once we know Chrome shows this tab's url, a hidden one is the initial about:blank (outside
    // our host access). Until then a hidden url is the page itself and `complete` is trusted.
    let visible = false;
    // Events wait for that answer; the read that follows it sees whatever they would have said.
    let ready = false;
    // A navigation we saw pending that settled where we can't see the page (a download, an empty
    // response, a redirect to an origin without host access): after a few such reads, stop waiting
    // and let the scan say what is really there (not a website, or site access needed).
    let pendingSeen = false;
    let blankReads = 0;
    // The latest read or event tab for this id, for the timeout's committed check, and since when
    // it has shown as committed. A read issued before an event can't overwrite what the event said.
    let last: TabLoadState | undefined;
    let committedAt: number | undefined;
    let events = 0;
    /** Loaded means `complete` on the real page, never the initial about:blank or a pending navigation. */
    const loaded = (t: TabLoadState) => {
      if (t.pendingUrl || (t.url && t.url !== 'about:blank')) visible = true;
      if (t.status !== 'complete' || t.pendingUrl) return false;
      return t.url ? t.url !== 'about:blank' : !visible;
    };
    const committed = (t?: TabLoadState) =>
      Boolean(t && !t.pendingUrl && t.url && t.url !== 'about:blank');
    const see = (t: TabLoadState) => {
      last = t;
      if (!committed(t)) committedAt = undefined;
      else committedAt ??= Date.now();
    };
    const timer = setTimeout(() => {
      const settledFor = committedAt === undefined ? 0 : Date.now() - committedAt;
      if (opts.scanIfCommitted && committed(last) && settledFor >= COMMITTED_MIN_MS) done();
      else done(new Error('The page took too long to load'));
    }, timeoutMs);
    const onUpdated = (tabId: number, info: { status?: string }, tab?: TabLoadState) => {
      if (tabId !== id) return;
      if (tab) {
        events++;
        see(tab);
      }
      if (!ready || info.status !== 'complete') return;
      // Without the tab argument, trust the event; with it, skip the initial about:blank.
      if (!tab || loaded(tab)) done();
    };
    const onRemoved = (tabId: number) => {
      if (tabId === id) done(new Error('The tab was closed'));
    };
    function done(err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(recheck);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (err) reject(err);
      else resolve();
    }
    function check() {
      const eventsBefore = events;
      chrome.tabs.get(id).then(
        (t) => {
          if (events === eventsBefore) see(t);
          if (loaded(t)) return done();
          if (t.pendingUrl) pendingSeen = true;
          const abandoned = pendingSeen && t.status === 'complete' && !t.pendingUrl;
          blankReads = abandoned ? blankReads + 1 : 0;
          if (blankReads >= ABANDONED_READS) done();
          else if (!settled) recheck = setTimeout(check, recheckMs);
        },
        (e: unknown) => {
          if (/No tab with id/i.test(e instanceof Error ? e.message : String(e))) {
            done(new Error('The tab was closed'));
          } else if (!settled) recheck = setTimeout(check, recheckMs); // a passing read failure
        },
      );
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    void urlVisible(opts.url).then((v) => {
      visible ||= v;
      ready = true;
      if (!settled) check();
    });
  });
}

/** Close a tab we opened, best effort: it may already be gone, and cleanup never throws. */
async function closeOwnTab(id: number): Promise<void> {
  try {
    await chrome.tabs.remove(id);
  } catch {
    // Already closed (No tab with id) or not closable: the caller's own error is what matters.
  }
}

/** Bound on the scan itself: a page that committed but never reaches DOMContentLoaded can hold the injection. */
const RESCAN_SCAN_MS = 20000;

/**
 * Open `url` in a new foreground tab, wait for it to load, scan it, and return the result. On
 * success the tab stays open; on any failure the tab we opened (and only that one) is closed.
 * A page still loading at the time limit is scanned as it is once its navigation has committed.
 */
export async function rescanUrl(url: string): Promise<ScanOutcome & { favicon: string | null }> {
  const tab = await chrome.tabs.create({ url, active: true });
  const id = tab.id;
  if (id === undefined) throw new Error('Could not open a tab');
  try {
    await waitForTabLoad(id, { url, scanIfCommitted: true });
    await new Promise((r) => setTimeout(r, 800)); // let late-rendering content settle
    const out = await scanWithin(id, RESCAN_SCAN_MS);
    const fresh = await chrome.tabs.get(id).catch(() => null);
    return { ...out, favicon: fresh?.favIconUrl ?? null };
  } catch (e) {
    await closeOwnTab(id);
    throw e;
  }
}

/** `scanTab`, rejecting with the timeout text after `ms`; a scan that answers later is never saved. */
async function scanWithin(id: number, ms: number): Promise<ScanOutcome> {
  const ctl = new AbortController();
  let bound: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    bound = setTimeout(() => {
      const err = new Error('The page took too long to load');
      ctl.abort(err);
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([scanTab(id, { signal: ctl.signal }), limit]);
  } finally {
    clearTimeout(bound);
  }
}

export { sameUrl } from './sameUrl';
