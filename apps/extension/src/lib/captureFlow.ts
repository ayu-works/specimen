/**
 * Secondary captures that run after a scan: mobile (a temporary popup window) and dark/light (the
 * page's own class switch). Neither needs a permission. Each returns data for the caller to merge
 * into the scan.
 */
import { counterpartKey, deltaE2000, detectScheme, extract, extractMobile } from '@specimen/core';
import type { ColorRole, DesignScan } from '@specimen/core/schema';
import { send } from './messaging';
import { sameUrl, waitForTabLoad } from './scanFlow';
import { rememberMobileWindow } from './tabEmulation';

export type MobileVariant = NonNullable<NonNullable<DesignScan['variants']>['mobile']>;
export type ThemeVariant = NonNullable<NonNullable<DesignScan['variants']>['dark']>;

const MOBILE_SIZE = { width: 390, height: 844 };
/** A capture wider than this is a desktop-ish window, never a phone: it is not stored as mobile. */
export const MOBILE_MAX_WIDTH = 480;
const MOBILE_SETTLE_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chrome (or a headless host) kept the popup wider than a phone. */
export class MobileTooWideError extends Error {
  constructor(public readonly width: number) {
    super(`Chrome kept the window too wide (${width}px)`);
    this.name = 'MobileTooWideError';
  }
}

/**
 * Why a mobile capture was skipped without a popup:
 * - `fullscreen`: Chrome is in full screen, where it can't show a separate small popup (macOS
 *   opens it as a tab or a full-size space).
 * - `tabbed`: Chrome opened the popup as a tab or a full-size window anyway.
 */
export type MobileSkipReason = 'fullscreen' | 'tabbed';

/** Nothing was captured and nothing is left open; `reason` says what the user can do. */
export class MobileSkippedError extends Error {
  constructor(public readonly reason: MobileSkipReason) {
    super(`Mobile capture skipped (${reason})`);
    this.name = 'MobileSkippedError';
  }
}

/** The window the user scanned from: the scanned tab's window, else the panel's current window. */
async function scanWindow(tabId?: number): Promise<chrome.windows.Window | null> {
  if (tabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(tabId);
      return await chrome.windows.get(tab.windowId);
    } catch {
      /* the tab is gone: fall back to the current window */
    }
  }
  try {
    return await chrome.windows.getCurrent();
  } catch {
    return null;
  }
}

const isFullscreen = (w: chrome.windows.Window | null | undefined) =>
  w?.state === 'fullscreen' || w?.state === 'locked-fullscreen';

async function tabsIn(windowId: number) {
  try {
    return await chrome.tabs.query({ windowId });
  } catch {
    return null;
  }
}

const blank = (u: string | undefined) => !u || u === 'about:blank';

/**
 * The one tab `windows.create` added to an existing window: a new id on `url`, or one still
 * blank (loading). Undefined unless exactly one matches, so a tab the user just opened (a new
 * tab page) is never closed. A page that already redirected is left too: a stray tab is the
 * safe failure.
 */
async function createdTab(windowId: number, before: Set<number>, url: string) {
  const after = await tabsIn(windowId);
  const added = (after ?? []).filter((t) => t.id !== undefined && !before.has(t.id));
  const onUrl = added.filter((t) => sameUrl(t.url, url) || sameUrl(t.pendingUrl, url));
  if (onUrl.length === 1) return onUrl[0]?.id;
  if (onUrl.length > 1) return undefined;
  const loading = added.filter((t) => blank(t.url) && blank(t.pendingUrl));
  return added.length === 1 && loading.length === 1 ? loading[0]?.id : undefined;
}

/**
 * Load `url` in a temporary phone-sized popup window, sample it, and close it. Browsers enforce a
 * minimum popup width, so the real viewport width decides: <= 480px is accepted, anything wider
 * throws `MobileTooWideError` and nothing is stored as "mobile".
 *
 * In full screen (checked on `tabId`'s window) no window is opened and this throws
 * `MobileSkippedError('fullscreen')`. The user's own tab is never re-sampled.
 * Only what this call created is ever closed: never the user's window or their other tabs.
 */
export async function captureMobile(
  url: string,
  desktop: DesignScan,
  opts: { tabId?: number } = {},
): Promise<MobileVariant> {
  const home = await scanWindow(opts.tabId);
  if (isFullscreen(home)) throw new MobileSkippedError('fullscreen');
  const homeId = home?.id;
  const homeTabs = homeId !== undefined ? await tabsIn(homeId) : null;
  const before = homeTabs
    ? new Set(homeTabs.flatMap((t) => (t.id === undefined ? [] : [t.id])))
    : null;
  const win = await chrome.windows.create({
    url,
    type: 'popup',
    width: MOBILE_SIZE.width,
    height: MOBILE_SIZE.height,
    focused: false,
  });
  if (!win) throw new Error('Could not open the mobile window');
  // Chrome put the page in an existing window (one of ours never has more than one tab).
  const intoExisting = (win.id !== undefined && win.id === homeId) || (win.tabs?.length ?? 0) > 1;
  // Only a window we created is recorded for recovery: never one of the user's.
  const ownWindow = !intoExisting && win.id !== undefined && win.id !== homeId;
  if (ownWindow) await rememberMobileWindow(win.id as number);
  let strayTab: number | undefined;
  try {
    if (intoExisting) {
      // Only the home window has a snapshot to diff against; in any other window close nothing.
      if (win.id === homeId && homeId !== undefined && before) {
        strayTab = await createdTab(homeId, before, url);
      }
      throw new MobileSkippedError('tabbed');
    }
    if (isFullscreen(win) || (win.type !== undefined && win.type !== 'popup')) {
      throw new MobileSkippedError('tabbed');
    }
    const tabId = win.tabs?.[0]?.id;
    if (tabId === undefined) throw new Error('Could not open the mobile window');
    await waitForTabLoad(tabId, { url });
    await sleep(MOBILE_SETTLE_MS);
    const res = await send('scan.run', {
      tabId,
      opts: { noScreenshot: true, skipComponents: true },
    });
    if (res.raw.viewport.w > MOBILE_MAX_WIDTH) throw new MobileTooWideError(res.raw.viewport.w);
    return extractMobile(res.raw, desktop);
  } finally {
    if (intoExisting) {
      if (strayTab !== undefined) await chrome.tabs.remove(strayTab).catch(() => {});
    } else if (win.id !== undefined) await chrome.windows.remove(win.id).catch(() => {});
    if (ownWindow) await rememberMobileWindow(null);
  }
}

function toVariant(
  base: DesignScan,
  scheme: 'dark' | 'light',
  alt: DesignScan,
): ThemeVariant | null {
  // The re-sample must really be in the other scheme and visibly different from the base.
  if (detectScheme(alt.colors) !== scheme) return null;
  const bg = (s: DesignScan['colors']) => {
    const id = s.roles.background;
    return id ? s.palette.find((t) => t.id === id)?.hex : undefined;
  };
  const a = bg(base.colors);
  const b = bg(alt.colors);
  if (!a || !b || deltaE2000(a, b) < 8) return null;
  const idMap = new Map(alt.colors.palette.map((t) => [t.id, `${scheme}-${t.id}`]));
  const roles: Partial<Record<ColorRole, string>> = {};
  for (const [role, id] of Object.entries(alt.colors.roles) as [ColorRole, string][]) {
    const next = idMap.get(id);
    if (next) roles[role] = next;
  }
  return {
    palette: alt.colors.palette.map((t) => ({ ...t, id: idMap.get(t.id) ?? t.id })),
    roles,
    gradients: alt.colors.gradients,
    measured: true,
  };
}

/**
 * Re-sample the page's colors in the opposite scheme by toggling the page's own theme switch (no
 * permission). Returns null when the switch did not apply or the page did not change.
 */
export async function captureTheme(
  scan: DesignScan,
  tabId: number,
): Promise<{ key: 'dark' | 'light'; variant: ThemeVariant } | null> {
  const key = counterpartKey(scan);
  const res = await send('scan.run', {
    tabId,
    opts: { colorsOnly: true, noScreenshot: true, theme: key },
  });
  if (!res.raw.hints?.themeApplied) return null;
  const variant = toVariant(scan, key, extract(res.raw, { validate: false }));
  return variant ? { key, variant } : null;
}
