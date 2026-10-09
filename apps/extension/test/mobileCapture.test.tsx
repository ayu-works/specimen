// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extract } from '@specimen/core';
import type { RawPage } from '@specimen/core/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_EXTRAS, useStore } from '../src/entrypoints/sidepanel/store';
import { Scan } from '../src/entrypoints/sidepanel/views/Scan';
import { captureMobile, MOBILE_MAX_WIDTH, MobileTooWideError } from '../src/lib/captureFlow';
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
}

/** A fake browser: the popup opens at `widths[0]`; the next scan.run reports the next width. */
function rig(opts: { widths: number[]; debuggerGranted: boolean }): Rig {
  const chrome = installChrome() as FakeChrome & Record<string, unknown>;
  const state: Rig = { chrome, widths: [...opts.widths], debuggerCalls: [], scanCalls: 0 };
  const win = { id: 7, tabs: [{ id: 42 }] };
  Object.assign(chrome, {
    windows: { create: vi.fn(async () => win), remove: vi.fn(async () => {}) },
    debugger: {
      attach: vi.fn(async () => state.debuggerCalls.push('attach')),
      detach: vi.fn(async () => state.debuggerCalls.push('detach')),
      sendCommand: vi.fn(async (_t: unknown, method: string) => {
        state.debuggerCalls.push(method);
      }),
    },
  });
  (chrome.tabs as Record<string, unknown>).get = vi.fn(async () => ({
    id: 42,
    status: 'complete',
  }));
  chrome.permissions.contains = vi.fn(async () => opts.debuggerGranted) as never;
  chrome.runtime.sendMessage = vi.fn(async () => {
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
    const m = await run(captureMobile('https://x.test/', desktop));
    expect(m.viewportWidth).toBe(390);
    expect(r.debuggerCalls).toEqual([]);
    expect(r.scanCalls).toBe(1);
  });

  it('T5.03 a popup Chrome kept too wide is emulated at 390x844 when debugger is granted', async () => {
    const r = rig({ widths: [1280, 390], debuggerGranted: true });
    const m = await run(captureMobile('https://x.test/', desktop));
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
    const win = r.chrome.windows as { remove: ReturnType<typeof vi.fn> };
    expect(win.remove).toHaveBeenCalledWith(7);
  });

  it('T5.03 too wide and no debugger permission: nothing is returned, never a fake "mobile"', async () => {
    const r = rig({ widths: [1280], debuggerGranted: false });
    const err = await run(captureMobile('https://x.test/', desktop)).catch((e) => e);
    expect(err).toBeInstanceOf(MobileTooWideError);
    expect((err as MobileTooWideError).width).toBe(1280);
    expect(r.debuggerCalls).toEqual([]);
    // The temporary window is still closed.
    expect((r.chrome.windows as { remove: ReturnType<typeof vi.fn> }).remove).toHaveBeenCalled();
  });

  it('T5.03 emulation that still reports a desktop width is rejected too', async () => {
    const r = rig({ widths: [1280, 1280], debuggerGranted: true });
    const err = await run(captureMobile('https://x.test/', desktop)).catch((e) => e);
    expect(err).toBeInstanceOf(MobileTooWideError);
    // The override was cleared and the debugger detached even though it failed.
    expect(r.debuggerCalls.slice(-2)).toEqual(['Emulation.clearDeviceMetricsOverride', 'detach']);
  });

  it('T5.03 the phone limit is 480px', () => {
    expect(MOBILE_MAX_WIDTH).toBe(480);
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
