import { hasMeasuredCounterpart } from '@specimen/core';
import type { DesignScan, RawHints } from '@specimen/core/schema';
import {
  captureMobile,
  captureTheme,
  MobileTooWideError,
  requestDebugger,
} from '@/lib/captureFlow';
import { updateScan } from '@/lib/db';
import { sameUrl } from '@/lib/scanFlow';
import { useStore } from './store';

const KEY_MOBILE = 'settings.captureMobile';

export async function loadMobilePref(): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get(KEY_MOBILE);
    return got[KEY_MOBILE] !== false;
  } catch {
    return true;
  }
}

export async function saveMobilePref(on: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY_MOBILE]: on });
  } catch {
    /* the choice just won't persist */
  }
}

const live = (scanId: string) => useStore.getState().scan?.id === scanId;

/** Merge a captured variant into the current scan, in the store and the Library. */
async function attach(scan: DesignScan, variants: NonNullable<DesignScan['variants']>) {
  const next = { ...scan, variants: { ...scan.variants, ...variants } };
  useStore.getState().setScan(next);
  try {
    await updateScan(scan.id, { variants: next.variants });
  } catch {
    /* library unavailable: the capture still shows for this session */
  }
  return next;
}

/** The current scan, fresh from the store (captures run one after another). */
const current = (scanId: string): DesignScan | null => {
  const s = useStore.getState().scan;
  return s?.id === scanId ? s : null;
};

async function tabStillOnPage(tabId: number, url: string): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return sameUrl(tab.url, url);
  } catch {
    return false;
  }
}

/** Try the page's own theme switch (no permission). Falls back to offering the media capture. */
export async function runThemeCapture(
  scan: DesignScan,
  tabId: number,
  hints: RawHints | undefined,
) {
  const { patchExtras } = useStore.getState();
  if (hasMeasuredCounterpart(scan)) {
    patchExtras({ theme: 'measured' });
    return;
  }
  const hasSwitch =
    (hints?.darkSelectors?.length ?? 0) > 0 || (hints?.lightSelectors?.length ?? 0) > 0;
  if (hasSwitch && (await tabStillOnPage(tabId, scan.url))) {
    patchExtras({ theme: 'running' });
    try {
      const got = await captureTheme(scan, tabId, 'class');
      if (got && live(scan.id)) {
        await attach(current(scan.id) ?? scan, { [got.key]: got.variant });
        patchExtras({ theme: 'measured' });
        return;
      }
    } catch {
      /* fall through to the media offer */
    }
  }
  if (!live(scan.id)) return;
  patchExtras({ theme: hints?.prefersScheme ? 'offer' : 'none' });
}

/** Click handler: request the optional `debugger` permission, then emulate the color scheme. */
export async function runMediaCapture(scan: DesignScan): Promise<void> {
  const { patchExtras, extras } = useStore.getState();
  const tabId = extras.tabId;
  if (tabId === null || !(await tabStillOnPage(tabId, scan.url))) {
    patchExtras({ theme: 'offer', note: 'Switch back to the tab you scanned, then try again.' });
    return;
  }
  patchExtras({ theme: 'running', note: null });
  try {
    if (!(await requestDebugger())) {
      patchExtras({ theme: 'offer', note: 'Permission not granted. Nothing was captured.' });
      return;
    }
    const got = await captureTheme(scan, tabId, 'media');
    if (!live(scan.id)) return;
    if (got) {
      await attach(current(scan.id) ?? scan, { [got.key]: got.variant });
      patchExtras({ theme: 'measured' });
    } else patchExtras({ theme: 'none', note: 'The page looks the same in the other mode.' });
  } catch (e) {
    patchExtras({
      theme: 'offer',
      note: `Capture failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

/**
 * Capture the mobile layout. `withPermission` runs inside a click handler: it requests the
 * optional `debugger` permission first so a too-wide popup can be emulated instead.
 */
export async function runMobileCapture(scan: DesignScan, withPermission = false): Promise<void> {
  const { patchExtras } = useStore.getState();
  patchExtras({ mobile: 'running', note: null });
  try {
    if (withPermission && !(await requestDebugger())) {
      patchExtras({ mobile: 'wide', note: 'Permission not granted. Nothing was captured.' });
      return;
    }
    const mobile = await captureMobile(scan.url, scan);
    if (!live(scan.id)) return;
    await attach(current(scan.id) ?? scan, { mobile });
    patchExtras({ mobile: 'done' });
  } catch (e) {
    if (e instanceof MobileTooWideError) {
      patchExtras({ mobile: 'wide' });
      return;
    }
    patchExtras({
      mobile: 'failed',
      note: `Mobile capture skipped: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

/** What happens right after a tab scan: theme (class switch), then mobile if enabled. */
export async function runExtras(
  scan: DesignScan,
  tabId: number,
  hints: RawHints | undefined,
  withMobile: boolean,
): Promise<void> {
  useStore.getState().patchExtras({ tabId, hints: hints ?? null });
  await runThemeCapture(scan, tabId, hints);
  if (withMobile && live(scan.id)) await runMobileCapture(current(scan.id) ?? scan);
}
