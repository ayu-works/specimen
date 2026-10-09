import { ensureSiteAccess, friendlyScanError, scanTab } from '@/lib/scanFlow';
import { loadMobilePref, runExtras } from './extras';
import { useStore } from './store';

/** Scan the active tab into the store, then start the mobile / dark-mode extras. */
export async function runTabScan(): Promise<void> {
  const { start, succeed, fail } = useStore.getState();
  start();
  try {
    await ensureSiteAccess();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('No active tab');
    if (tab.url && !/^https?:/.test(tab.url)) throw new Error(`Unsupported page: ${tab.url}`);
    const res = await scanTab(tab.id);
    succeed(res.scan, res.screenshot, tab.favIconUrl ?? null);
    void loadMobilePref().then((withMobile) =>
      runExtras(res.scan, tab.id as number, res.hints, withMobile),
    );
  } catch (e) {
    fail(friendlyScanError(e instanceof Error ? e.message : String(e)));
  }
}
