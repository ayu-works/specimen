import { hasMeasuredCounterpart } from '@specimen/core';
import type { DesignScan, RawHints } from '@specimen/core/schema';
import {
  captureMobile,
  captureTheme,
  MobileSkippedError,
  type MobileSkipReason,
  MobileTooWideError,
} from '@/lib/captureFlow';
import { libraryErrorText, updateScan } from '@/lib/db';
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
  } catch (e) {
    // The capture still shows for this session; say it won't be in the Library.
    if (live(scan.id))
      useStore
        .getState()
        .patchExtras({ note: `Captured, but not saved to Library: ${libraryErrorText(e)}.` });
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

/**
 * Try the page's own theme switch (no permission). A page whose other scheme only follows the OS
 * setting (`@media (prefers-color-scheme)`) is reported as `system`: it keeps the derived variant.
 */
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
      const got = await captureTheme(scan, tabId);
      if (got && live(scan.id)) {
        await attach(current(scan.id) ?? scan, { [got.key]: got.variant });
        patchExtras({ theme: 'measured' });
        return;
      }
    } catch {
      /* fall through: no measured variant */
    }
  }
  if (!live(scan.id)) return;
  patchExtras({ theme: hints?.prefersScheme ? 'system' : 'none' });
}

/** What the user can do about each skipped mobile capture. */
export const SKIP_NOTES: Record<MobileSkipReason, string> = {
  fullscreen: 'Mobile capture is skipped in full screen. Exit full screen, then try again.',
  tabbed: 'Chrome opened the mobile window as a tab, so nothing was captured. Try again.',
};

/**
 * Capture the mobile layout in a temporary popup window. The user's own tab is never touched. A
 * capture already running is never started twice.
 */
export async function runMobileCapture(scan: DesignScan): Promise<void> {
  const { patchExtras, extras } = useStore.getState();
  if (extras.mobile === 'running') return;
  patchExtras({ mobile: 'running', note: null });
  try {
    const mobile = await captureMobile(scan.url, scan, {
      tabId: useStore.getState().extras.tabId ?? undefined,
    });
    if (!live(scan.id)) return;
    await attach(current(scan.id) ?? scan, { mobile });
    patchExtras({ mobile: 'done', mobileSkip: null });
  } catch (e) {
    // A newer scan owns the card now: never paint this capture's failure on it.
    if (!live(scan.id)) return;
    if (e instanceof MobileSkippedError) {
      patchExtras({ mobile: 'skipped', mobileSkip: e.reason, note: SKIP_NOTES[e.reason] });
      return;
    }
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
