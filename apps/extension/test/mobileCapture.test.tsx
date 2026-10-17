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
  MobileTooWideError,
} from '../src/lib/captureFlow';
import { scanTab } from '../src/lib/scanFlow';
import { recoverMobileCapture } from '../src/lib/tabEmulation';
import { type FakeChrome, installChrome } from './helpers/chrome';

const rawFile = path.resolve(process.cwd(), '../../fixtures/raw/stripe.json');
const base = JSON.parse(readFileSync(rawFile, 'utf8')) as RawPage;
const rawAt = (w: number): RawPage => ({ ...base, viewport: { ...base.viewport, w } });
const desktop = extract(rawAt(1440), { validate: false });

interface Rig {
  chrome: FakeChrome & Record<string, unknown>;
  widths: number[];
  debuggerCalls: string[];
  scanCalls: number;
  /** Debugger methods and scan.run calls, in order. */
  log: string[];
  windows: { create: Mock; remove: Mock; get: Mock; getCurrent: Mock };
  tabsRemove: Mock;
}

type Mock = ReturnType<typeof vi.fn>;
type WinState = 'normal' | 'fullscreen';

interface RigOpts {
  widths: number[];
  debuggerGranted: boolean;
  /** The panel's window (id 1), which holds the scanned tab 5. */
  state?: WinState;
  /** Where the scanned tab lives, when not in the panel's window. */
  scannedTabWindow?: { id: number; state: WinState };
  /** The scanned tab's current url (default: the scanned page). */
  scannedTabUrl?: string;
  /** The single new tab in the user's window: redirected away, or a new tab page the user opened. */
  newTabUrl?: string;
  /** `chrome.debugger` is not bound in this context although the permission is held. */
  noDebuggerApi?: boolean;
  /** What `windows.create` hands back: a real popup (default), a full-screen window, or the panel's own window. */
  created?: 'popup' | 'fullscreen' | 'panel-window' | 'panel-window-ambiguous' | 'other-window';
  currentThrows?: boolean;
  attachThrows?: boolean;
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
    debuggerCalls: [],
    scanCalls: 0,
    log: [],
    windows,
    tabsRemove: vi.fn(async () => {}),
  };
  Object.assign(chrome, {
    windows,
    debugger: opts.noDebuggerApi
      ? undefined
      : {
          attach: vi.fn(async () => {
            if (opts.attachThrows) throw new Error('Another debugger is already attached');
            state.debuggerCalls.push('attach');
          }),
          detach: vi.fn(async () => state.debuggerCalls.push('detach')),
          sendCommand: vi.fn(async (_t: unknown, method: string) => {
            state.debuggerCalls.push(method);
            state.log.push(method);
          }),
        },
  });
  const tabs = chrome.tabs as Record<string, unknown>;
  tabs.get = vi.fn(async (id: number) =>
    id === 5
      ? { id: 5, windowId: scannedWin.id, url: opts.scannedTabUrl ?? PAGE, status: 'complete' }
      : { id, windowId: 7, status: 'complete', url: PAGE },
  );
  tabs.query = vi.fn(async (q: { windowId?: number }) =>
    q.windowId === 1 ? [...panelTabs] : q.windowId === 2 ? [...otherTabs] : [],
  );
  tabs.remove = state.tabsRemove;
  chrome.permissions.contains = vi.fn(async () => opts.debuggerGranted) as never;
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

describe('captureMobile', () => {
  it('T5.03 accepts a real phone-width popup and records its width', async () => {
    const r = rig({ widths: [390], debuggerGranted: false });
    const m = await run(captureMobile(PAGE, desktop));
    expect(m.viewportWidth).toBe(390);
    expect(r.debuggerCalls).toEqual([]);
    expect(r.scanCalls).toBe(1);
  });

  it('T5.03 a popup Chrome kept too wide is emulated at 390x844 when debugger is granted', async () => {
    const r = rig({ widths: [1280, 390], debuggerGranted: true });
    const m = await run(captureMobile(PAGE, desktop));
    expect(m.viewportWidth).toBe(390);
    expect(r.scanCalls).toBe(2);
    expect(r.debuggerCalls).toEqual([
      'attach',
      'Emulation.setDeviceMetricsOverride',
      'Emulation.clearDeviceMetricsOverride',
      'detach',
    ]);
    const dbg = r.chrome.debugger as { sendCommand: ReturnType<typeof vi.fn> };
    expect(dbg.sendCommand.mock.calls[0]?.[2]).toEqual({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    expect(r.windows.remove).toHaveBeenCalledWith(7);
  });

  it('T5.03 too wide and no debugger permission: nothing is returned, never a fake "mobile"', async () => {
    const r = rig({ widths: [1280], debuggerGranted: false });
    const err = await run(captureMobile(PAGE, desktop)).catch((e) => e);
    expect(err).toBeInstanceOf(MobileTooWideError);
    expect((err as MobileTooWideError).width).toBe(1280);
    expect(r.debuggerCalls).toEqual([]);
    // The temporary window is still closed.
    expect(r.windows.remove).toHaveBeenCalledWith(7);
  });

  it('T5.03 emulation that still reports a desktop width is rejected too', async () => {
    const r = rig({ widths: [1280, 1280], debuggerGranted: true });
    const err = await run(captureMobile(PAGE, desktop)).catch((e) => e);
    expect(err).toBeInstanceOf(MobileTooWideError);
    // The override was cleared and the debugger detached even though it failed.
    expect(r.debuggerCalls.slice(-2)).toEqual(['Emulation.clearDeviceMetricsOverride', 'detach']);
  });

  it('T5.03 a normal window still opens a 390x844 popup and closes it', async () => {
    const r = rig({ widths: [390], debuggerGranted: false });
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
    const r = rig({ widths: [390], debuggerGranted: false, scanRejects: true });
    const err = await run(captureMobile(PAGE, desktop)).catch((e) => e);
    expect((err as Error).message).toBe('scan failed');
    expect(r.windows.remove).toHaveBeenCalledWith(7);
  });

  it('T5.03 the phone limit is 480px', () => {
    expect(MOBILE_MAX_WIDTH).toBe(480);
  });
});

describe('captureMobile in full screen', () => {
  it('T5.11 full screen without debugger: skipped, no window or tab created', async () => {
    const r = rig({ widths: [390], debuggerGranted: false, state: 'fullscreen' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('fullscreen');
    expect(r.windows.create).not.toHaveBeenCalled();
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).not.toHaveBeenCalled();
    expect(r.debuggerCalls).toEqual([]);
  });

  it('T5.11 full screen with debugger: emulates a phone in the scanned tab, no window created', async () => {
    const r = rig({ widths: [390], debuggerGranted: true, state: 'fullscreen' });
    const m = await run(captureMobile(PAGE, desktop, { tabId: 5, emulate: true }));
    expect(m.viewportWidth).toBe(390);
    expect(r.windows.create).not.toHaveBeenCalled();
    const dbg = r.chrome.debugger as { attach: Mock };
    expect(dbg.attach).toHaveBeenCalledWith({ tabId: 5 }, '1.3');
    expect(r.debuggerCalls).toEqual([
      'attach',
      'Emulation.setDeviceMetricsOverride',
      'Emulation.clearDeviceMetricsOverride',
      'detach',
    ]);
  });

  it("T5.11 emulating in the user's tab: a failing scan or a desktop width still clears the override and detaches", async () => {
    const r1 = rig({
      widths: [390],
      debuggerGranted: true,
      state: 'fullscreen',
      scanRejects: true,
    });
    const e1 = await run(captureMobile(PAGE, desktop, { tabId: 5, emulate: true })).catch((e) => e);
    expect((e1 as Error).message).toBe('scan failed');
    expect(r1.debuggerCalls.slice(-2)).toEqual(['Emulation.clearDeviceMetricsOverride', 'detach']);

    const r2 = rig({ widths: [1280], debuggerGranted: true, state: 'fullscreen' });
    const e2 = await run(captureMobile(PAGE, desktop, { tabId: 5, emulate: true })).catch((e) => e);
    expect(e2).toBeInstanceOf(MobileTooWideError);
    expect(r2.debuggerCalls.slice(-2)).toEqual(['Emulation.clearDeviceMetricsOverride', 'detach']);
    expect(r2.windows.create).not.toHaveBeenCalled();
  });

  it('T5.11 full screen with debugger but no scanned tab: skipped, nothing attached or created', async () => {
    const r = rig({ widths: [390], debuggerGranted: true, state: 'fullscreen' });
    const err = await run(captureMobile(PAGE, desktop, { emulate: true })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('fullscreen');
    expect(r.windows.getCurrent).toHaveBeenCalled();
    expect(r.windows.create).not.toHaveBeenCalled();
    expect(r.debuggerCalls).toEqual([]);
  });

  it('T5.11 the scanned tab left the page: skipped, nothing attached', async () => {
    const r = rig({
      widths: [390],
      debuggerGranted: true,
      state: 'fullscreen',
      scannedTabUrl: 'https://x.test/elsewhere',
    });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5, emulate: true })).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('navigated');
    expect(r.debuggerCalls).toEqual([]);
    expect(r.windows.create).not.toHaveBeenCalled();
  });

  it('T5.11 the debugger cannot attach (DevTools open): skipped, no override set', async () => {
    const r = rig({
      widths: [390],
      debuggerGranted: true,
      state: 'fullscreen',
      attachThrows: true,
    });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5, emulate: true })).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('attach');
    expect(r.debuggerCalls).not.toContain('Emulation.setDeviceMetricsOverride');
    expect(r.scanCalls).toBe(0);
  });

  it("T5.11 preflight reads the scanned tab's window when there is a tab, else the current window", async () => {
    // The scanned tab's window is full screen; the panel's current window is not.
    const r1 = rig({
      widths: [390],
      debuggerGranted: false,
      scannedTabWindow: { id: 2, state: 'fullscreen' },
    });
    const e1 = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(e1).toBeInstanceOf(MobileSkippedError);
    expect((e1 as MobileSkippedError).reason).toBe('fullscreen');
    expect(r1.windows.get).toHaveBeenCalledWith(2);
    expect(r1.windows.create).not.toHaveBeenCalled();

    const r2 = rig({ widths: [390], debuggerGranted: false, state: 'fullscreen' });
    const e2 = await run(captureMobile(PAGE, desktop)).catch((e) => e);
    expect(e2).toBeInstanceOf(MobileSkippedError);
    expect((e2 as MobileSkippedError).reason).toBe('fullscreen');
    expect(r2.windows.getCurrent).toHaveBeenCalled();
  });

  it('T5.11 the window state cannot be read: the normal popup path runs', async () => {
    const r = rig({ widths: [390], debuggerGranted: false, currentThrows: true });
    const m = await run(captureMobile(PAGE, desktop));
    expect(m.viewportWidth).toBe(390);
    expect(r.windows.create).toHaveBeenCalled();
    expect(r.windows.remove).toHaveBeenCalledWith(7);
  });

  it('T5.11 Chrome hands back a full-screen window (toggled mid-capture): skipped, that window closed', async () => {
    const r = rig({ widths: [390], debuggerGranted: false, created: 'fullscreen' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('tabbed');
    expect(r.scanCalls).toBe(0);
    expect(r.windows.remove).toHaveBeenCalledWith(7);
  });

  it("T5.11 Chrome puts the page in the user's own window: only the new tab is closed", async () => {
    const r = rig({ widths: [390], debuggerGranted: false, created: 'panel-window' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('tabbed');
    expect(r.scanCalls).toBe(0);
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).toHaveBeenCalledTimes(1);
    expect(r.tabsRemove).toHaveBeenCalledWith(9);
  });

  it("T5.11 the user's window gains two matching tabs: nothing is closed", async () => {
    const r = rig({ widths: [390], debuggerGranted: false, created: 'panel-window-ambiguous' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('tabbed');
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).not.toHaveBeenCalled();
  });

  it("T5.11 Chrome puts the page in another of the user's windows: nothing is closed", async () => {
    const r = rig({ widths: [390], debuggerGranted: false, created: 'other-window' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('tabbed');
    expect(r.scanCalls).toBe(0);
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).not.toHaveBeenCalled();
  });
});

describe('captureMobile in full screen: more failure paths', () => {
  it("T5.11 a lone new tab not on the page (the user's new tab page, or a redirect) is never closed", async () => {
    for (const newTabUrl of ['chrome://newtab/', 'https://x.test/en/']) {
      const r = rig({ widths: [390], debuggerGranted: false, created: 'panel-window', newTabUrl });
      const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
      expect((err as MobileSkippedError).reason).toBe('tabbed');
      expect(r.tabsRemove).not.toHaveBeenCalled();
      expect(r.windows.remove).not.toHaveBeenCalled();
    }
  });

  it('T5.11 a lone new tab still loading (about:blank) is ours and is closed', async () => {
    const r = rig({
      widths: [390],
      debuggerGranted: false,
      created: 'panel-window',
      newTabUrl: 'about:blank',
    });
    await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch(() => {});
    expect(r.tabsRemove).toHaveBeenCalledWith(9);
  });

  it("T5.11 another of the user's windows is never recorded for recovery", async () => {
    const r = rig({ widths: [390], debuggerGranted: false, created: 'other-window' });
    await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch(() => {});
    const writes = (r.chrome.storage.session.set as Mock).mock.calls.map((c) => c[0]);
    expect(writes.some((w) => 'mobile.window' in w)).toBe(false);
    // So a later recovery (panel closed mid-capture) has no window of theirs to close.
    r.chrome.runtime.getContexts = vi.fn(async () => [{}]) as never;
    r.chrome.storage.session.data.set('mobile.emulatingTab', 5);
    await recoverMobileCapture();
    expect(r.windows.remove).not.toHaveBeenCalled();
  });

  it('T5.11 no chrome.debugger in this context: skipped as "attach", never "too wide"', async () => {
    const r = rig({
      widths: [390],
      debuggerGranted: true,
      state: 'fullscreen',
      noDebuggerApi: true,
    });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5, emulate: true })).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(MobileSkippedError);
    expect((err as MobileSkippedError).reason).toBe('attach');
    expect(r.scanCalls).toBe(0);
  });

  it('T5.11 a desktop scan during the emulation waits until the override is cleared', async () => {
    const r = rig({ widths: [390], debuggerGranted: true, state: 'fullscreen' });
    const mobile = captureMobile(PAGE, desktop, { tabId: 5, emulate: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(r.log).toContain('Emulation.setDeviceMetricsOverride');
    // The tab is recorded so a panel closed now gets it back on its next start.
    expect(r.chrome.storage.session.data.get('mobile.emulatingTab')).toBe(5);
    const desk = scanTab(5, { save: false, noScreenshot: true });
    await run(Promise.all([mobile, desk]));
    expect(r.log).toEqual([
      'Emulation.setDeviceMetricsOverride',
      'scan.run',
      'Emulation.clearDeviceMetricsOverride',
      'scan.run',
    ]);
    expect(r.chrome.storage.session.data.has('mobile.emulatingTab')).toBe(false);
  });
});

describe('recoverMobileCapture (side panel start)', () => {
  function leftovers(panels: number) {
    const c = installChrome() as FakeChrome & Record<string, unknown>;
    const dbg = { sendCommand: vi.fn(async () => {}), detach: vi.fn(async () => {}) };
    const windows = { remove: vi.fn(async () => {}) };
    Object.assign(c, { debugger: dbg, windows });
    c.runtime.getContexts = vi.fn(async () => Array.from({ length: panels }, () => ({}))) as never;
    c.storage.session.data.set('mobile.emulatingTab', 5);
    c.storage.session.data.set('mobile.window', 7);
    return { c, dbg, windows };
  }

  it('T5.11 clears a phone override and closes a popup a closed panel left behind', async () => {
    const { c, dbg, windows } = leftovers(1);
    await recoverMobileCapture();
    expect(dbg.sendCommand).toHaveBeenCalledWith(
      { tabId: 5 },
      'Emulation.clearDeviceMetricsOverride',
    );
    expect(dbg.detach).toHaveBeenCalledWith({ tabId: 5 });
    expect(windows.remove).toHaveBeenCalledWith(7);
    expect(c.storage.session.data.size).toBe(0);
  });

  it('T5.11 leaves everything alone while another side panel may be capturing', async () => {
    const { c, dbg, windows } = leftovers(2);
    await recoverMobileCapture();
    expect(dbg.sendCommand).not.toHaveBeenCalled();
    expect(windows.remove).not.toHaveBeenCalled();
    expect(c.storage.session.data.get('mobile.emulatingTab')).toBe(5);
  });

  it('T5.11 the popup is recorded while open and forgotten once closed', async () => {
    const r = rig({ widths: [390], debuggerGranted: false });
    await run(captureMobile(PAGE, desktop, { tabId: 5 }));
    expect(r.chrome.storage.session.set).toHaveBeenCalledWith({ 'mobile.window': 7 });
    expect(r.chrome.storage.session.data.has('mobile.window')).toBe(false);
  });
});

describe('runMobileCapture in full screen', () => {
  const start = () =>
    useStore.setState({
      scan: desktop,
      status: 'done',
      extras: { ...NO_EXTRAS, scanId: desktop.id, tabId: 5 },
    });

  it("T5.11 the automatic capture never emulates in the user's tab, even with the permission held", async () => {
    const r = rig({
      widths: [390],
      debuggerGranted: true,
      state: 'fullscreen',
      scannedTabUrl: desktop.url,
    });
    start();
    await run(runExtras(desktop, 5, undefined, true));
    expect(r.debuggerCalls).toEqual([]);
    expect(r.windows.create).not.toHaveBeenCalled();
    expect(useStore.getState().extras.mobile).toBe('skipped');
    expect(useStore.getState().extras.mobileSkip).toBe('fullscreen');
    expect(useStore.getState().extras.note).toBe(SKIP_NOTES.fullscreen);
    expect(useStore.getState().scan?.variants?.mobile).toBeUndefined();

    // Only the click emulates, in the scanned tab.
    await run(runMobileCapture(desktop, true));
    const dbg = r.chrome.debugger as { attach: Mock };
    expect(dbg.attach).toHaveBeenCalledWith({ tabId: 5 }, '1.3');
    expect(useStore.getState().extras.mobile).toBe('done');
    expect(useStore.getState().scan?.variants?.mobile?.viewportWidth).toBe(390);
  });

  it('T5.11 each skip reason gets its own note', async () => {
    const cases: [RigOpts, 'fullscreen' | 'navigated' | 'attach' | 'tabbed'][] = [
      [{ widths: [390], debuggerGranted: false, state: 'fullscreen' }, 'fullscreen'],
      [
        {
          widths: [390],
          debuggerGranted: true,
          state: 'fullscreen',
          scannedTabUrl: 'https://x.test/other',
        },
        'navigated',
      ],
      [
        {
          widths: [390],
          debuggerGranted: true,
          state: 'fullscreen',
          attachThrows: true,
          scannedTabUrl: desktop.url,
        },
        'attach',
      ],
      [{ widths: [390], debuggerGranted: false, created: 'fullscreen' }, 'tabbed'],
    ];
    for (const [o, reason] of cases) {
      rig(o);
      start();
      await run(runMobileCapture(desktop, reason === 'navigated' || reason === 'attach'));
      expect(useStore.getState().extras.mobileSkip).toBe(reason);
      expect(useStore.getState().extras.note).toBe(SKIP_NOTES[reason]);
    }
    expect(SKIP_NOTES.navigated).toMatch(/Switch back to the page you scanned/);
    expect(SKIP_NOTES.attach).toMatch(/Close DevTools/);
    expect(SKIP_NOTES.tabbed).not.toMatch(/full screen/);
  });

  it('T5.11 a capture already running is not started twice', async () => {
    const r = rig({ widths: [390], debuggerGranted: false });
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
    rig({ widths: [390], debuggerGranted: false, scanRejects: true });
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
  const show = (mobileSkip: 'fullscreen' | 'navigated' | 'attach' | 'tabbed') =>
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

  it('T5.11 full screen: note, "Capture in this tab", and no buttons while running', async () => {
    vi.useRealTimers();
    const c = installChrome();
    show('fullscreen');
    const { rerender } = render(<Scan />);

    expect((await screen.findByTestId('mobile-skipped')).textContent).toBe(
      'skipped in full screen',
    );
    expect(screen.getByText(SKIP_NOTES.fullscreen)).toBeTruthy();
    expect(useStore.getState().scan?.variants?.mobile).toBeUndefined();

    c.permissions.request.mockResolvedValue(false);
    c.permissions.contains.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Capture in this tab' }));
    await waitFor(() =>
      expect(c.permissions.request).toHaveBeenCalledWith({ permissions: ['debugger'] }),
    );
    await screen.findByText('Permission not granted. Nothing was captured.');
    expect(useStore.getState().extras.mobile).toBe('skipped');

    useStore.setState({
      extras: { ...useStore.getState().extras, mobile: 'running' },
    });
    rerender(<Scan />);
    expect(screen.getByText(/this page shows at phone width/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Capture in this tab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'capture' })).toBeNull();
  });

  it('T5.11 DevTools in the way: the note says so and the button reads "Try again"', async () => {
    vi.useRealTimers();
    installChrome();
    show('attach');
    render(<Scan />);
    expect((await screen.findByTestId('mobile-skipped')).textContent).toBe('not captured');
    expect(screen.getByText(SKIP_NOTES.attach)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Capture in this tab' })).toBeNull();
  });
});

describe('Scan card: mobile too wide', () => {
  it('T5.03 shows "not captured" with a one-click permission button, and stores no mobile variant', async () => {
    vi.useRealTimers();
    const c = installChrome();
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
    expect(useStore.getState().scan?.variants?.mobile).toBeUndefined();

    // One click asks for the optional `debugger` permission, like the dark-mode capture.
    c.permissions.request.mockResolvedValue(false);
    c.permissions.contains.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Capture with permission' }));
    await waitFor(() =>
      expect(c.permissions.request).toHaveBeenCalledWith({ permissions: ['debugger'] }),
    );
    await screen.findByText('Permission not granted. Nothing was captured.');
    expect(useStore.getState().extras.mobile).toBe('wide');
    expect(useStore.getState().scan?.variants?.mobile).toBeUndefined();
  });
});
