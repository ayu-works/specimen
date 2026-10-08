import { extract } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';
import { saveScan } from './db';
import { send } from './messaging';

export function friendlyScanError(msg: string): string {
  if (/Unsupported page|chrome:\/\/|chrome-extension:\/\/|extensions gallery|webstore/i.test(msg))
    return "Can't scan chrome:// pages or the Chrome Web Store. Open a regular website and try again.";
  if (/No active tab/.test(msg)) return 'No active tab to scan.';
  if (/declined/.test(msg))
    return 'Specimen needs permission to read the page you scan. Click Scan again and choose Allow.';
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
}

/** Scan a tab and save the result (with thumbnail) to the library. Saving never fails the scan. */
export async function scanTab(tabId: number): Promise<ScanOutcome> {
  const res = await send('scan.run', { tabId });
  const scan = extract(res.raw);
  try {
    await saveScan(scan, res.screenshot);
  } catch {
    /* library unavailable (private mode, quota): the scan itself still works */
  }
  return { scan, screenshot: res.screenshot };
}

/** Open `url` in a new foreground tab, wait for it to load, scan it, and return the result. */
export async function rescanUrl(url: string): Promise<ScanOutcome & { favicon: string | null }> {
  const tab = await chrome.tabs.create({ url, active: true });
  const id = tab.id;
  if (id === undefined) throw new Error('Could not open a tab');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('The page took too long to load')), 30000);
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
  await new Promise((r) => setTimeout(r, 800)); // let late-rendering content settle
  const out = await scanTab(id);
  const fresh = await chrome.tabs.get(id).catch(() => null);
  return { ...out, favicon: fresh?.favIconUrl ?? null };
}
