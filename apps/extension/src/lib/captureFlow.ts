/**
 * Secondary captures that run after a scan: mobile (a temporary popup window, or emulation in the
 * scanned tab when Chrome is in full screen), dark/light
 * (class switch, or `prefers-color-scheme` emulation behind the optional `debugger`
 * permission) and extra pages. Each returns data for the caller to merge into the scan.
 */
import { counterpartKey, deltaE2000, detectScheme, extract, extractMobile } from '@specimen/core';
import type { ColorRole, DesignScan } from '@specimen/core/schema';
import { send } from './messaging';
import { sameUrl, waitForTabLoad } from './scanFlow';

export type MobileVariant = NonNullable<NonNullable<DesignScan['variants']>['mobile']>;
export type ThemeVariant = NonNullable<NonNullable<DesignScan['variants']>['dark']>;

const MOBILE_SIZE = { width: 390, height: 844 };
/** A capture wider than this is a desktop-ish window, never a phone: it is not stored as mobile. */
export const MOBILE_MAX_WIDTH = 480;
const MOBILE_SETTLE_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chrome (or a headless host) kept the popup wider than a phone and we could not emulate one. */
export class MobileTooWideError extends Error {
  constructor(public readonly width: number) {
    super(`Chrome kept the window too wide (${width}px)`);
    this.name = 'MobileTooWideError';
  }
}

/**
 * Chrome is in full screen, where it can't show a separate small popup (macOS opens it as a tab or
 * a full-size space). Nothing is captured; nothing is left open.
 */
export class MobileFullscreenError extends Error {
  constructor() {
    super('Mobile capture is skipped in full screen');
    this.name = 'MobileFullscreenError';
  }
}

/** The debugger could not attach (DevTools open, or another debugger already attached). */
class AttachError extends Error {
  constructor(cause: unknown) {
    super(
      `Could not attach the debugger: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'AttachError';
  }
}

async function hasDebugger(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({
      permissions: ['debugger' as chrome.runtime.ManifestPermission],
    });
  } catch {
    return false;
  }
}

/** Re-sample a tab under a 390x844 device-metrics override (needs the `debugger` permission). */
async function sampleEmulatedPhone(tabId: number) {
  const dbg = (chrome as { debugger?: typeof chrome.debugger }).debugger;
  if (!dbg) throw new MobileTooWideError(0);
  const target = { tabId };
  try {
    await dbg.attach(target, '1.3');
  } catch (e) {
    throw new AttachError(e);
  }
  try {
    await dbg.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
      ...MOBILE_SIZE,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(MOBILE_SETTLE_MS / 3);
    return await send('scan.run', {
      tabId,
      opts: { noScreenshot: true, skipComponents: true },
    });
  } finally {
    await dbg.sendCommand(target, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    await dbg.detach(target).catch(() => {});
  }
}

/** Re-sample until the width is a phone's, or throw. `raw` is the first (popup) sample, if any. */
async function phoneSample(tabId: number, first?: Awaited<ReturnType<typeof sampleEmulatedPhone>>) {
  let res = first;
  if (!res || res.raw.viewport.w > MOBILE_MAX_WIDTH) {
    if (res && !(await hasDebugger())) throw new MobileTooWideError(res.raw.viewport.w);
    res = await sampleEmulatedPhone(tabId);
    if (res.raw.viewport.w > MOBILE_MAX_WIDTH) throw new MobileTooWideError(res.raw.viewport.w);
  }
  return res;
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

/**
 * The one tab `windows.create` added to an existing window: a new id loading `url`. Undefined
 * unless exactly one matches, so we never close a tab the user had open.
 */
async function createdTab(windowId: number, before: Set<number>, url: string) {
  const after = await tabsIn(windowId);
  const added = (after ?? []).filter(
    (t) =>
      t.id !== undefined &&
      !before.has(t.id) &&
      (sameUrl(t.url, url) || sameUrl(t.pendingUrl, url)),
  );
  return added.length === 1 ? added[0]?.id : undefined;
}

/** Emulate a phone in the user's own (scanned) tab; needs the `debugger` permission. */
async function emulateInTab(url: string, tabId: number) {
  // The user may have navigated since the scan: never emulate (and re-sample) another page.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!sameUrl(tab?.url, url)) throw new MobileFullscreenError();
  try {
    return await phoneSample(tabId);
  } catch (e) {
    throw e instanceof AttachError ? new MobileFullscreenError() : e;
  }
}

/**
 * Load `url` in a temporary phone-sized popup window, sample it, and close it. Browsers enforce a
 * minimum popup width, so the real viewport width decides: <= 480px is accepted; otherwise the
 * page is re-sampled under device-metrics emulation when the optional `debugger` permission is
 * held. With neither, this throws `MobileTooWideError` and nothing is stored as "mobile".
 *
 * In full screen (checked on `tabId`'s window) no window is opened: with the `debugger` permission
 * the phone is emulated in the scanned tab `tabId`; otherwise this throws `MobileFullscreenError`.
 * Only what this call created is ever closed: never the user's window or their other tabs.
 */
export async function captureMobile(
  url: string,
  desktop: DesignScan,
  opts: { tabId?: number } = {},
): Promise<MobileVariant> {
  const home = await scanWindow(opts.tabId);
  if (isFullscreen(home)) {
    if (opts.tabId === undefined || !(await hasDebugger())) throw new MobileFullscreenError();
    const res = await emulateInTab(url, opts.tabId);
    return extractMobile(res.raw, desktop);
  }
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
  let strayTab: number | undefined;
  try {
    if (intoExisting) {
      if (win.id !== undefined && before) strayTab = await createdTab(win.id, before, url);
      throw new MobileFullscreenError();
    }
    if (isFullscreen(win) || (win.type !== undefined && win.type !== 'popup')) {
      throw new MobileFullscreenError();
    }
    const tabId = win.tabs?.[0]?.id;
    if (tabId === undefined) throw new Error('Could not open the mobile window');
    await waitForTabLoad(tabId);
    await sleep(MOBILE_SETTLE_MS);
    const first = await send('scan.run', {
      tabId,
      opts: { noScreenshot: true, skipComponents: true },
    });
    const res = await phoneSample(tabId, first);
    return extractMobile(res.raw, desktop);
  } finally {
    if (intoExisting) {
      if (strayTab !== undefined) await chrome.tabs.remove(strayTab).catch(() => {});
    } else if (win.id !== undefined) await chrome.windows.remove(win.id).catch(() => {});
  }
}

/** Ask for the optional `debugger` permission (must run inside a click handler). */
export async function requestDebugger(): Promise<boolean> {
  const permissions = ['debugger' as chrome.runtime.ManifestPermission];
  if (await chrome.permissions.contains({ permissions })) return true;
  return chrome.permissions.request({ permissions });
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
 * Re-sample the page's colors in the opposite scheme. `class` toggles the page's own theme switch
 * (no permission); `media` emulates `prefers-color-scheme` through the debugger. Returns null when
 * the page did not change.
 */
export async function captureTheme(
  scan: DesignScan,
  tabId: number,
  how: 'class' | 'media',
): Promise<{ key: 'dark' | 'light'; variant: ThemeVariant } | null> {
  const key = counterpartKey(scan);
  const res = await send('scan.run', {
    tabId,
    opts: {
      colorsOnly: true,
      noScreenshot: true,
      ...(how === 'class' ? { theme: key } : { emulate: key }),
    },
  });
  if (how === 'class' && !res.raw.hints?.themeApplied) return null;
  const variant = toVariant(scan, key, extract(res.raw, { validate: false }));
  return variant ? { key, variant } : null;
}
