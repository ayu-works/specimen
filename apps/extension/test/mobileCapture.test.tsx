// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extract } from '@specimen/core';
import type { RawPage } from '@specimen/core/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runExtras, runMobileCapture, SKIP_NOTES } from '../src/entrypoints/sidepanel/extras';
import { NO_EXTRAS, useStore } from '../src/entrypoints/sidepanel/store';
import { Scan } from '../src/entrypoints/sidepanel/views/Scan';
import {
  captureMobile,
  MOBILE_MAX_WIDTH,
  MobileSkippedError,
  type MobileSkipReason,
  MobileTooWideError,
} from '../src/lib/captureFlow';
import { recoverMobileCapture } from '../src/lib/tabEmulation';
import { type FakeChrome, installChrome } from './helpers/chrome';

const rawFile = path.resolve(process.cwd(), '../../fixtures/raw/stripe.json');
const base = JSON.parse(readFileSync(rawFile, 'utf8')) as RawPage;
const rawAt = (w: number): RawPage => ({ ...base, viewport: { ...base.viewport, w } });
const desktop = extract(rawAt(1440), { validate: false });

interface Rig {
  chrome: FakeChrome & Record<string, unknown>;
  widths: number[];
  scanCalls: number;
  /** scan.run calls, and every read of `chrome.debugger` (there must be none), in order. */
  log: string[];
  windows: { create: Mock; remove: Mock; get: Mock; getCurrent: Mock };
  tabsRemove: Mock;
}

type Mock = ReturnType<typeof vi.fn>;
type WinState = 'normal' | 'fullscreen';

interface RigOpts {
  widths: number[];
  /** The panel's window (id 1), which holds the scanned tab 5. */
  state?: WinState;
  /** Where the scanned tab lives, when not in the panel's window. */
  scannedTabWindow?: { id: number; state: WinState };
  /** The single new tab in the user's window: redirected away, or a new tab page the user opened. */
  newTabUrl?: string;
  /** What `windows.create` hands back: a real popup (default), a full-screen window, or the panel's own window. */
  created?: 'popup' | 'fullscreen' | 'panel-window' | 'panel-window-ambiguous' | 'other-window';
  currentThrows?: boolean;
  scanRejects?: boolean;
}

const PAGE = 'https://x.test/';

/** A fake browser: the popup opens at `widths[0]`; the next scan.run reports the next width. */
function rig(opts: RigOpts): Rig {
  const chrome = installChrome() as FakeChrome & Record<string, unknown>;
  const panelWin = { id: 1, type: 'normal', state: opts.state ?? 'normal' };
  const scannedWin = opts.scannedTabWindow ?? panelWin;
  // The panel window's tabs: ours (when Chrome puts it there) is never at index 0.
  let panelTabs: { id: number; url?: string; pendingUrl?: string }[] = [
    { id: 3, url: 'https://other.test/' },
    { id: 5, url: PAGE },
  ];
  // Another of the user's windows: their tab on the same page, and ours with no url yet.
  const otherTabs = [{ id: 20, url: PAGE }, { id: 21 }];
  const created = opts.created ?? 'popup';
  const windows = {
    create: vi.fn(async () => {
      if (created === 'popup') return { id: 7, type: 'popup', state: 'normal', tabs: [{ id: 42 }] };
      if (created === 'other-window')
        return { id: 2, type: 'normal', state: 'normal', tabs: otherTabs };
      if (created === 'fullscreen')
        return { id: 7, type: 'normal', state: 'fullscreen', tabs: [{ id: 42 }] };
      const ours = opts.newTabUrl ? { id: 9, url: opts.newTabUrl } : { id: 9, pendingUrl: PAGE };
      panelTabs = [panelTabs[0], ours, ...panelTabs.slice(1)] as typeof panelTabs;
      if (created === 'panel-window-ambiguous') panelTabs.push({ id: 11, url: PAGE });
      return { ...panelWin, tabs: panelTabs };
    }),
    remove: vi.fn(async () => {}),
    get: vi.fn(async (id: number) => (id === scannedWin.id ? scannedWin : panelWin)),
    getCurrent: vi.fn(async () => {
      if (opts.currentThrows) throw new Error('no window');
      return panelWin;
    }),
  };
  const state: Rig = {
    chrome,
    widths: [...opts.widths],
    scanCalls: 0,
    log: [],
    windows,
    tabsRemove: vi.fn(async () => {}),
  };
  Object.assign(chrome, { windows });
  // SPC-44: nothing may reach for the DevTools protocol any more. A read is logged, never served.
  Object.defineProperty(chrome, 'debugger', {
    configurable: true,
    get: () => {
      state.log.push('chrome.debugger');
      return undefined;
    },
  });
  const tabs = chrome.tabs as Record<string, unknown>;
  tabs.get = vi.fn(async (id: number) =>
    id === 5
      ? { id: 5, windowId: scannedWin.id, url: PAGE, status: 'complete' }
      : { id, windowId: 7, status: 'complete', url: PAGE },
  );
  tabs.query = vi.fn(async (q: { windowId?: number }) =>
    q.windowId === 1 ? [...panelTabs] : q.windowId === 2 ? [...otherTabs] : [],
  );
  tabs.remove = state.tabsRemove;
  chrome.runtime.sendMessage = vi.fn(async () => {
    state.log.push('scan.run');
    if (opts.scanRejects) throw new Error('scan failed');
    const w = state.widths[Math.min(state.scanCalls, state.widths.length - 1)] as number;
    state.scanCalls++;
    return { ok: true, data: { raw: rawAt(w), screenshot: '' } };
  }) as never;
  return state;
}

async function run<T>(p: Promise<T>): Promise<T> {
  const settled = p.then(
    (v) => ({ v }),
    (e) => ({ e }),
  );
  await vi.runAllTimersAsync();
  const out = await settled;
  if ('e' in out) throw out.e;
  return out.v;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Nothing touched the DevTools protocol, asked for any permission, or checked for `debugger`. */
function expectNoDebugger(r: Rig) {
  expect(r.log).not.toContain('chrome.debugger');
  expect(r.chrome.permissions.request).not.toHaveBeenCalled();
  // The popup's page-load wait may check site access (origins); never a named permission.
  for (const [q] of (r.chrome.permissions.contains as Mock).mock.calls) {
    expect((q as { permissions?: unknown }).permissions).toBeUndefined();
  }
}

describe('captureMobile', () => {
  it('T5.03 accepts a real phone-width popup and records its width', async () => {
    const r = rig({ widths: [390] });
    const m = await run(captureMobile(PAGE, desktop));
    expect(m.viewportWidth).toBe(390);
    expect(r.scanCalls).toBe(1);
    expect(r.windows.remove).toHaveBeenCalledWith(7);
    expectNoDebugger(r);
  });

  it('T5.03 a popup Chrome kept too wide: MobileTooWideError with its width, never a fake "mobile"', async () => {
    for (const w of [500, 1280]) {
      const r = rig({ widths: [w] });
      const err = await run(captureMobile(PAGE, desktop)).catch((e) => e);
      expect(err).toBeInstanceOf(MobileTooWideError);
      expect((err as MobileTooWideError).width).toBe(w);
      // One sample only: there is no second (emulated) try.
      expect(r.scanCalls).toBe(1);
      // The temporary window is still closed.
      expect(r.windows.remove).toHaveBeenCalledWith(7);
      expectNoDebugger(r);
    }
  });

  it('T5.03 the phone limit is 480px: 480 is accepted, 481 is not', async () => {
    expect(MOBILE_MAX_WIDTH).toBe(480);
    rig({ widths: [480] });
    expect((await run(captureMobile(PAGE, desktop))).viewportWidth).toBe(480);
    rig({ widths: [481] });
    const err = await run(captureMobile(PAGE, desktop)).catch((e) => e);
    expect(err).toBeInstanceOf(MobileTooWideError);
  });

  it('T5.03 a normal window still opens a 390x844 popup and closes it', async () => {
    const r = rig({ widths: [390] });
    await run(captureMobile(PAGE, desktop, { tabId: 5 }));
    expect(r.windows.create).toHaveBeenCalledWith({
      url: PAGE,
      type: 'popup',
      width: 390,
      height: 844,
      focused: false,
    });
    expect(r.windows.remove).toHaveBeenCalledWith(7);
    expect(r.tabsRemove).not.toHaveBeenCalled();
  });

  it('T5.03 a scan that fails in the popup still closes the popup', async () => {
    const r = rig({ widths: [390], scanRejects: true });
    const err = await run(captureMobile(PAGE, desktop)).catch((e) => e);
    expect((err as Error).message).toBe('scan failed');
    expect(r.windows.remove).toHaveBeenCalledWith(7);
  });
});

describe('captureMobile in full screen', () => {
  it("T5.11 full screen: skipped, no window or tab created, the user's tab never sampled", async () => {
    const r = rig({ widths: [390], state: 'fullscreen' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('fullscreen');
    expect(r.windows.create).not.toHaveBeenCalled();
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).not.toHaveBeenCalled();
    expect(r.scanCalls).toBe(0);
    expectNoDebugger(r);
  });

  it("T5.11 preflight reads the scanned tab's window when there is a tab, else the current window", async () => {
    // The scanned tab's window is full screen; the panel's current window is not.
    const r1 = rig({ widths: [390], scannedTabWindow: { id: 2, state: 'fullscreen' } });
    const e1 = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(e1).toBeInstanceOf(MobileSkippedError);
    expect((e1 as MobileSkippedError).reason).toBe('fullscreen');
    expect(r1.windows.get).toHaveBeenCalledWith(2);
    expect(r1.windows.create).not.toHaveBeenCalled();

    const r2 = rig({ widths: [390], state: 'fullscreen' });
    const e2 = await run(captureMobile(PAGE, desktop)).catch((e) => e);
    expect(e2).toBeInstanceOf(MobileSkippedError);
    expect((e2 as MobileSkippedError).reason).toBe('fullscreen');
    expect(r2.windows.getCurrent).toHaveBeenCalled();
  });

  it('T5.11 the window state cannot be read: the normal popup path runs', async () => {
    const r = rig({ widths: [390], currentThrows: true });
    const m = await run(captureMobile(PAGE, desktop));
    expect(m.viewportWidth).toBe(390);
    expect(r.windows.create).toHaveBeenCalled();
    expect(r.windows.remove).toHaveBeenCalledWith(7);
  });

  it('T5.11 Chrome hands back a full-screen window (toggled mid-capture): skipped, that window closed', async () => {
    const r = rig({ widths: [390], created: 'fullscreen' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('tabbed');
    expect(r.scanCalls).toBe(0);
    expect(r.windows.remove).toHaveBeenCalledWith(7);
  });

  it("T5.11 Chrome puts the page in the user's own window: only the new tab is closed", async () => {
    const r = rig({ widths: [390], created: 'panel-window' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('tabbed');
    expect(r.scanCalls).toBe(0);
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).toHaveBeenCalledTimes(1);
    expect(r.tabsRemove).toHaveBeenCalledWith(9);
  });

  it("T5.11 the user's window gains two matching tabs: nothing is closed", async () => {
    const r = rig({ widths: [390], created: 'panel-window-ambiguous' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('tabbed');
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).not.toHaveBeenCalled();
  });

  it("T5.11 Chrome puts the page in another of the user's windows: nothing is closed", async () => {
    const r = rig({ widths: [390], created: 'other-window' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('tabbed');
    expect(r.scanCalls).toBe(0);
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).not.toHaveBeenCalled();
  });
});

describe('captureMobile: more popup failure paths', () => {
  it("T5.11 a lone new tab not on the page (the user's new tab page, or a redirect) is never closed", async () => {
    for (const newTabUrl of ['chrome://newtab/', 'https://x.test/en/']) {
      const r = rig({ widths: [390], created: 'panel-window', newTabUrl });
      const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
      expect((err as MobileSkippedError).reason).toBe('tabbed');
      expect(r.tabsRemove).not.toHaveBeenCalled();
      expect(r.windows.remove).not.toHaveBeenCalled();
    }
  });

  it('T5.11 a lone new tab still loading (about:blank) is ours and is closed', async () => {
    const r = rig({
      widths: [390],
      created: 'panel-window',
      newTabUrl: 'about:blank',
    });
    await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch(() => {});
    expect(r.tabsRemove).toHaveBeenCalledWith(9);
  });

  it("T5.11 another of the user's windows is never recorded for recovery", async () => {
    const r = rig({ widths: [390], created: 'other-window' });
    await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch(() => {});
    const writes = (r.chrome.storage.session.set as Mock).mock.calls.map((c) => c[0]);
    expect(writes.some((w) => 'mobile.window' in w)).toBe(false);
    // So a later recovery (panel closed mid-capture) has no window of theirs to close.
    r.chrome.runtime.getContexts = vi.fn(async () => [{}]) as never;
    await recoverMobileCapture();
    expect(r.windows.remove).not.toHaveBeenCalled();
  });
});

describe('recoverMobileCapture (side panel start)', () => {
  function leftovers(panels: number) {
    const c = installChrome() as FakeChrome & Record<string, unknown>;
    const windows = { remove: vi.fn(async () => {}) };
    const log: string[] = [];
    Object.assign(c, { windows });
    Object.defineProperty(c, 'debugger', {
      configurable: true,
      get: () => {
        log.push('chrome.debugger');
        return undefined;
      },
    });
    c.runtime.getContexts = vi.fn(async () => Array.from({ length: panels }, () => ({}))) as never;
    // Written by a version before SPC-44, which emulated a phone in the user's tab.
    c.storage.session.data.set('mobile.emulatingTab', 5);
    c.storage.session.data.set('mobile.window', 7);
    return { c, windows, log };
  }

  it('T5.11 closes a popup a closed panel left behind and clears the legacy tab record', async () => {
    const { c, windows, log } = leftovers(1);
    await recoverMobileCapture();
    expect(windows.remove).toHaveBeenCalledWith(7);
    expect(c.storage.session.data.size).toBe(0);
    expect(log).toEqual([]);
  });

  it('T5.11 leaves everything alone while another side panel may be capturing', async () => {
    const { c, windows } = leftovers(2);
    await recoverMobileCapture();
    expect(windows.remove).not.toHaveBeenCalled();
    expect(c.storage.session.data.get('mobile.window')).toBe(7);
  });

  it('T5.11 the popup is recorded while open and forgotten once closed', async () => {
    const r = rig({ widths: [390] });
    await run(captureMobile(PAGE, desktop, { tabId: 5 }));
    expect(r.chrome.storage.session.set).toHaveBeenCalledWith({ 'mobile.window': 7 });
    expect(r.chrome.storage.session.data.has('mobile.window')).toBe(false);
  });
});

describe('runMobileCapture', () => {
  const start = () =>
    useStore.setState({
      scan: desktop,
      status: 'done',
      extras: { ...NO_EXTRAS, scanId: desktop.id, tabId: 5 },
    });

  it("T5.11 full screen: the automatic capture and a retry both skip, and never touch the user's tab", async () => {
    const r = rig({ widths: [390], state: 'fullscreen' });
    start();
    await run(runExtras(desktop, 5, undefined, true));
    expect(r.windows.create).not.toHaveBeenCalled();
    expect(useStore.getState().extras.mobile).toBe('skipped');
    expect(useStore.getState().extras.mobileSkip).toBe('fullscreen');
    expect(useStore.getState().extras.note).toBe(SKIP_NOTES.fullscreen);
    expect(useStore.getState().scan?.variants?.mobile).toBeUndefined();

    await run(runMobileCapture(desktop));
    expect(useStore.getState().extras.mobileSkip).toBe('fullscreen');
    expect(r.scanCalls).toBe(0);
    expectNoDebugger(r);
  });

  it('T5.03 too wide: state "wide", no note, no variant, no permission asked', async () => {
    const r = rig({ widths: [1280] });
    start();
    await run(runMobileCapture(desktop));
    expect(useStore.getState().extras.mobile).toBe('wide');
    expect(useStore.getState().scan?.variants?.mobile).toBeUndefined();
    expectNoDebugger(r);
  });

  it('T5.11 each skip reason gets its own note', async () => {
    const cases: [RigOpts, MobileSkipReason][] = [
      [{ widths: [390], state: 'fullscreen' }, 'fullscreen'],
      [{ widths: [390], created: 'fullscreen' }, 'tabbed'],
    ];
    for (const [o, reason] of cases) {
      rig(o);
      start();
      await run(runMobileCapture(desktop));
      expect(useStore.getState().extras.mobileSkip).toBe(reason);
      expect(useStore.getState().extras.note).toBe(SKIP_NOTES[reason]);
    }
    expect(Object.keys(SKIP_NOTES).sort()).toEqual(['fullscreen', 'tabbed']);
    expect(SKIP_NOTES.fullscreen).toMatch(/Exit full screen/);
    expect(SKIP_NOTES.tabbed).not.toMatch(/full screen/);
  });

  it('T5.11 a capture already running is not started twice', async () => {
    const r = rig({ widths: [390] });
    useStore.setState({
      scan: desktop,
      status: 'done',
      extras: { ...NO_EXTRAS, scanId: desktop.id, tabId: 5, mobile: 'running' },
    });
    await run(runMobileCapture(desktop));
    expect(r.windows.create).not.toHaveBeenCalled();
    expect(useStore.getState().extras.mobile).toBe('running');
  });
});

describe('runMobileCapture after a newer scan', () => {
  it("T5.11 a stale capture's failure never lands on the next scan's card", async () => {
    rig({ widths: [390], scanRejects: true });
    useStore.setState({
      scan: desktop,
      status: 'done',
      extras: { ...NO_EXTRAS, scanId: desktop.id, tabId: 5 },
    });
    const pending = run(runMobileCapture(desktop));
    const next = { ...desktop, id: 'scan-b' };
    useStore.setState({
      scan: next,
      extras: { ...NO_EXTRAS, scanId: next.id, tabId: 5, mobile: 'running' },
    });
    await pending;
    expect(useStore.getState().extras.mobile).toBe('running');
    expect(useStore.getState().extras.note).toBeNull();
  });
});

describe('Scan card: mobile skipped', () => {
  const show = (mobileSkip: MobileSkipReason) =>
    useStore.setState({
      scan: desktop,
      status: 'done',
      extras: {
        ...NO_EXTRAS,
        scanId: desktop.id,
        tabId: 5,
        mobile: 'skipped',
        mobileSkip,
        note: SKIP_NOTES[mobileSkip],
      },
    });

  it('T5.11 full screen: note and "Try again" (never "Capture in this tab"), which re-runs the popup path', async () => {
    vi.useRealTimers();
    const r = rig({ widths: [390] });
    show('fullscreen');
    const { rerender } = render(<Scan />);

    expect((await screen.findByTestId('mobile-skipped')).textContent).toBe(
      'skipped in full screen',
    );
    expect(screen.getByText(SKIP_NOTES.fullscreen)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Capture in this tab' })).toBeNull();
    expect(useStore.getState().scan?.variants?.mobile).toBeUndefined();

    // The user left full screen: the retry opens the popup and captures.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    // Real timers here: the popup's 1.5 s settle runs for real.
    await waitFor(() => expect(useStore.getState().extras.mobile).toBe('done'), { timeout: 5000 });
    expect(r.windows.create).toHaveBeenCalledTimes(1);
    expect(useStore.getState().scan?.variants?.mobile?.viewportWidth).toBe(390);
    expectNoDebugger(r);

    useStore.setState({
      scan: desktop,
      extras: { ...useStore.getState().extras, mobile: 'running' },
    });
    rerender(<Scan />);
    expect(screen.getByText(/a small window opens for a moment/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'capture' })).toBeNull();
  });

  it('T5.11 opened as a tab: "not captured" and "Try again"', async () => {
    vi.useRealTimers();
    installChrome();
    show('tabbed');
    render(<Scan />);
    expect((await screen.findByTestId('mobile-skipped')).textContent).toBe('not captured');
    expect(screen.getByText(SKIP_NOTES.tabbed)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('Scan card: mobile too wide', () => {
  it('T5.03 shows "not captured" with no permission button, and stores no mobile variant', async () => {
    vi.useRealTimers();
    installChrome();
    useStore.setState({
      scan: desktop,
      status: 'done',
      extras: { ...NO_EXTRAS, scanId: desktop.id, tabId: 1, mobile: 'wide' },
    });
    render(<Scan />);

    expect((await screen.findByTestId('mobile-wide')).textContent).toBe(
      'not captured (Chrome kept the window too wide)',
    );
    expect(screen.queryByText(/Mobile\s*captured/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Capture with permission' })).toBeNull();
    expect(screen.queryByText(/permission|debugging/i)).toBeNull();
    expect(useStore.getState().scan?.variants?.mobile).toBeUndefined();
  });
});
