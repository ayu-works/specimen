/**
 * Secondary captures that run after a scan: mobile (a temporary popup window), dark/light
 * (class switch, or `prefers-color-scheme` emulation behind the optional `debugger`
 * permission) and extra pages. Each returns data for the caller to merge into the scan.
 */
import { counterpartKey, deltaE2000, detectScheme, extract, extractMobile } from '@specimen/core';
import type { ColorRole, DesignScan } from '@specimen/core/schema';
import { send } from './messaging';
import { waitForTabLoad } from './scanFlow';

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
  await dbg.attach(target, '1.3');
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

/**
 * Load `url` in a temporary phone-sized popup window, sample it, and close it. Browsers enforce a
 * minimum popup width, so the real viewport width decides: <= 480px is accepted; otherwise the
 * page is re-sampled under device-metrics emulation when the optional `debugger` permission is
 * held. With neither, this throws `MobileTooWideError` and nothing is stored as "mobile".
 */
export async function captureMobile(url: string, desktop: DesignScan): Promise<MobileVariant> {
  const win = await chrome.windows.create({
    url,
    type: 'popup',
    width: MOBILE_SIZE.width,
    height: MOBILE_SIZE.height,
    focused: false,
  });
  if (!win) throw new Error('Could not open the mobile window');
  try {
    const tabId = win.tabs?.[0]?.id;
    if (tabId === undefined) throw new Error('Could not open the mobile window');
    await waitForTabLoad(tabId);
    await sleep(MOBILE_SETTLE_MS);
    let res = await send('scan.run', {
      tabId,
      opts: { noScreenshot: true, skipComponents: true },
    });
    if (res.raw.viewport.w > MOBILE_MAX_WIDTH) {
      if (!(await hasDebugger())) throw new MobileTooWideError(res.raw.viewport.w);
      res = await sampleEmulatedPhone(tabId);
      if (res.raw.viewport.w > MOBILE_MAX_WIDTH) throw new MobileTooWideError(res.raw.viewport.w);
    }
    return extractMobile(res.raw, desktop);
  } finally {
    if (win.id !== undefined) await chrome.windows.remove(win.id).catch(() => {});
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
