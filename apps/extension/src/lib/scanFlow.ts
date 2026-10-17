import { extract } from '@specimen/core';
import type { DesignScan, RawPage } from '@specimen/core/schema';
import { libraryErrorText, saveScan } from './db';
import { send } from './messaging';
import { tabEmulationIdle } from './tabEmulation';

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
}

/**
 * Scan a tab and save the result (with thumbnail) to the library. A failed save never fails the
 * scan; it comes back as `saveError` so the panel can say so.
 */
export async function scanTab(tabId: number, opts: ScanTabOptions = {}): Promise<ScanOutcome> {
  // A mobile capture may have a phone override on this tab: never record that as the desktop.
  await tabEmulationIdle();
  const res = await send('scan.run', {
    tabId,
    opts: opts.noScreenshot ? { noScreenshot: true } : undefined,
  });
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
    /** Loaded means `complete` on the real page, never the initial about:blank or a pending navigation. */
    const loaded = (t: TabLoadState) => {
      if (t.pendingUrl || (t.url && t.url !== 'about:blank')) visible = true;
      if (t.status !== 'complete' || t.pendingUrl) return false;
      return t.url ? t.url !== 'about:blank' : !visible;
    };
    const timer = setTimeout(() => done(new Error('The page took too long to load')), timeoutMs);
    const onUpdated = (tabId: number, info: { status?: string }, tab?: TabLoadState) => {
      if (!ready || tabId !== id || info.status !== 'complete') return;
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
      chrome.tabs.get(id).then(
        (t) => {
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

/** Open `url` in a new foreground tab, wait for it to load, scan it, and return the result. */
export async function rescanUrl(url: string): Promise<ScanOutcome & { favicon: string | null }> {
  const tab = await chrome.tabs.create({ url, active: true });
  const id = tab.id;
  if (id === undefined) throw new Error('Could not open a tab');
  await waitForTabLoad(id, { url });
  await new Promise((r) => setTimeout(r, 800)); // let late-rendering content settle
  const out = await scanTab(id);
  const fresh = await chrome.tabs.get(id).catch(() => null);
  return { ...out, favicon: fresh?.favIconUrl ?? null };
}

export { sameUrl } from './sameUrl';
