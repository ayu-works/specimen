import { extract } from '@specimen/core';
import type { DesignScan, RawPage } from '@specimen/core/schema';
import { libraryErrorText, saveScan } from './db';
import { send } from './messaging';
import { tabEmulationIdle } from './tabEmulation';

const SITE_ACCESS =
  'Specimen needs permission to read the page you scan. Click Scan again and choose Allow.';

/** Turn a scan error (ours or Chrome's) into a sentence the panel can show. */
export function friendlyScanError(msg: string): string {
  if (/chrome:\/\/|chrome-extension:\/\/|extensions gallery|webstore/i.test(msg))
    return "Can't scan chrome:// pages or the Chrome Web Store. Open a regular website and try again.";
  if (/Unsupported page/.test(msg))
    return 'Specimen can only scan websites (http or https). Open one and try again.';
  if (/No active tab/.test(msg)) return 'No active tab to scan.';
  if (/declined|user gesture|Cannot access contents|Missing host permission/i.test(msg))
    return SITE_ACCESS;
  if (/No tab with id|tab was closed/i.test(msg))
    return 'The tab was closed before the scan finished.';
  if (/Receiving end does not exist|Could not establish connection|no response for/i.test(msg))
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

/** Resolve when the tab finishes loading; reject on timeout or when it is closed. */
export function waitForTabLoad(id: number, timeoutMs = 30000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('The page took too long to load')), timeoutMs);
    const onUpdated = (tabId: number, info: { status?: string }) => {
      if (tabId === id && info.status === 'complete') done();
    };
    const onRemoved = (tabId: number) => {
      if (tabId === id) done(new Error('The tab was closed'));
    };
    function done(err?: Error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (err) reject(err);
      else resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    // The tab may already be complete by the time the listener is attached.
    chrome.tabs
      .get(id)
      .then((t) => {
        if (t.status === 'complete') done();
      })
      .catch(() => {});
  });
}

/** Open `url` in a new foreground tab, wait for it to load, scan it, and return the result. */
export async function rescanUrl(url: string): Promise<ScanOutcome & { favicon: string | null }> {
  const tab = await chrome.tabs.create({ url, active: true });
  const id = tab.id;
  if (id === undefined) throw new Error('Could not open a tab');
  await waitForTabLoad(id);
  await new Promise((r) => setTimeout(r, 800)); // let late-rendering content settle
  const out = await scanTab(id);
  const fresh = await chrome.tabs.get(id).catch(() => null);
  return { ...out, favicon: fresh?.favIconUrl ?? null };
}

/** Same page, ignoring hash, query order and a trailing slash. */
export function sameUrl(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (u: URL) => u.pathname.replace(/\/+$/, '') || '/';
    return x.origin === y.origin && path(x) === path(y) && x.search === y.search;
  } catch {
    return a === b;
  }
}
