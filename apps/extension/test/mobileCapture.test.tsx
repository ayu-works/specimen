// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extract } from '@specimen/core';
import type { RawPage } from '@specimen/core/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMobileCapture } from '../src/entrypoints/sidepanel/extras';
import { NO_EXTRAS, useStore } from '../src/entrypoints/sidepanel/store';
import { Scan } from '../src/entrypoints/sidepanel/views/Scan';
import {
  captureMobile,
  MOBILE_MAX_WIDTH,
  MobileFullscreenError,
  MobileTooWideError,
} from '../src/lib/captureFlow';
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
  /** What `windows.create` hands back: a real popup (default), a full-screen window, or the panel's own window. */
  created?: 'popup' | 'fullscreen' | 'panel-window' | 'panel-window-ambiguous';
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
  const created = opts.created ?? 'popup';
  const windows = {
    create: vi.fn(async () => {
      if (created === 'popup') return { id: 7, type: 'popup', state: 'normal', tabs: [{ id: 42 }] };
      if (created === 'fullscreen')
        return { id: 7, type: 'normal', state: 'fullscreen', tabs: [{ id: 42 }] };
      panelTabs = [
        panelTabs[0],
        { id: 9, pendingUrl: PAGE },
        ...panelTabs.slice(1),
      ] as typeof panelTabs;
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
    windows,
    tabsRemove: vi.fn(async () => {}),
  };
  Object.assign(chrome, {
    windows,
    debugger: {
      attach: vi.fn(async () => {
        if (opts.attachThrows) throw new Error('Another debugger is already attached');
        state.debuggerCalls.push('attach');
      }),
      detach: vi.fn(async () => state.debuggerCalls.push('detach')),
      sendCommand: vi.fn(async (_t: unknown, method: string) => {
        state.debuggerCalls.push(method);
      }),
    },
  });
  const tabs = chrome.tabs as Record<string, unknown>;
  tabs.get = vi.fn(async (id: number) =>
    id === 5
      ? { id: 5, windowId: scannedWin.id, url: opts.scannedTabUrl ?? PAGE, status: 'complete' }
      : { id, windowId: 7, status: 'complete' },
  );
  tabs.query = vi.fn(async (q: { windowId?: number }) => (q.windowId === 1 ? [...panelTabs] : []));
  tabs.remove = state.tabsRemove;
  chrome.permissions.contains = vi.fn(async () => opts.debuggerGranted) as never;
  chrome.runtime.sendMessage = vi.fn(async () => {
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
    expect(err).toBeInstanceOf(MobileFullscreenError);
    expect(r.windows.create).not.toHaveBeenCalled();
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).not.toHaveBeenCalled();
    expect(r.debuggerCalls).toEqual([]);
  });

  it('T5.11 full screen with debugger: emulates a phone in the scanned tab, no window created', async () => {
    const r = rig({ widths: [390], debuggerGranted: true, state: 'fullscreen' });
    const m = await run(captureMobile(PAGE, desktop, { tabId: 5 }));
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
    const e1 = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect((e1 as Error).message).toBe('scan failed');
    expect(r1.debuggerCalls.slice(-2)).toEqual(['Emulation.clearDeviceMetricsOverride', 'detach']);

    const r2 = rig({ widths: [1280], debuggerGranted: true, state: 'fullscreen' });
    const e2 = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(e2).toBeInstanceOf(MobileTooWideError);
    expect(r2.debuggerCalls.slice(-2)).toEqual(['Emulation.clearDeviceMetricsOverride', 'detach']);
    expect(r2.windows.create).not.toHaveBeenCalled();
  });

  it('T5.11 full screen with debugger but no scanned tab: skipped, nothing attached or created', async () => {
    const r = rig({ widths: [390], debuggerGranted: true, state: 'fullscreen' });
    const err = await run(captureMobile(PAGE, desktop)).catch((e) => e);
    expect(err).toBeInstanceOf(MobileFullscreenError);
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
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileFullscreenError);
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
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileFullscreenError);
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
    expect(e1).toBeInstanceOf(MobileFullscreenError);
    expect(r1.windows.get).toHaveBeenCalledWith(2);
    expect(r1.windows.create).not.toHaveBeenCalled();

    const r2 = rig({ widths: [390], debuggerGranted: false, state: 'fullscreen' });
    const e2 = await run(captureMobile(PAGE, desktop)).catch((e) => e);
    expect(e2).toBeInstanceOf(MobileFullscreenError);
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
    expect(err).toBeInstanceOf(MobileFullscreenError);
    expect(r.scanCalls).toBe(0);
    expect(r.windows.remove).toHaveBeenCalledWith(7);
  });

  it("T5.11 Chrome puts the page in the user's own window: only the new tab is closed", async () => {
    const r = rig({ widths: [390], debuggerGranted: false, created: 'panel-window' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileFullscreenError);
    expect(r.scanCalls).toBe(0);
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).toHaveBeenCalledTimes(1);
    expect(r.tabsRemove).toHaveBeenCalledWith(9);
  });

  it("T5.11 the user's window gains two matching tabs: nothing is closed", async () => {
    const r = rig({ widths: [390], debuggerGranted: false, created: 'panel-window-ambiguous' });
    const err = await run(captureMobile(PAGE, desktop, { tabId: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(MobileFullscreenError);
    expect(r.windows.remove).not.toHaveBeenCalled();
    expect(r.tabsRemove).not.toHaveBeenCalled();
  });
});

describe('runMobileCapture in full screen', () => {
  it('T5.11 marks the card "fullscreen" and stores no mobile variant', async () => {
    rig({ widths: [390], debuggerGranted: false, state: 'fullscreen' });
    useStore.setState({
      scan: desktop,
      status: 'done',
      extras: { ...NO_EXTRAS, scanId: desktop.id, tabId: 5 },
    });
    await run(runMobileCapture(desktop));
    expect(useStore.getState().extras.mobile).toBe('fullscreen');
    expect(useStore.getState().scan?.variants?.mobile).toBeUndefined();
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

describe('Scan card: mobile in full screen', () => {
  it('T5.11 shows the full-screen note and a permission button; no buttons while running', async () => {
    vi.useRealTimers();
    const c = installChrome();
    useStore.setState({
      scan: desktop,
      status: 'done',
      extras: { ...NO_EXTRAS, scanId: desktop.id, tabId: 5, mobile: 'fullscreen' },
    });
    const { rerender } = render(<Scan />);

    expect((await screen.findByTestId('mobile-fullscreen')).textContent).toBe(
      'skipped in full screen',
    );
    expect(screen.getByTestId('mobile-fullscreen-note').textContent).toMatch(
      /Mobile capture is skipped in full screen\. Exit full screen/,
    );
    expect(useStore.getState().scan?.variants?.mobile).toBeUndefined();

    c.permissions.request.mockResolvedValue(false);
    c.permissions.contains.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Capture with permission' }));
    await waitFor(() =>
      expect(c.permissions.request).toHaveBeenCalledWith({ permissions: ['debugger'] }),
    );

    useStore.setState({
      extras: { ...NO_EXTRAS, scanId: desktop.id, tabId: 5, mobile: 'running' },
    });
    rerender(<Scan />);
    expect(screen.queryByRole('button', { name: 'Capture with permission' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'capture' })).toBeNull();
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
