// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extract } from '@specimen/core';
import type { RawHints, RawPage } from '@specimen/core/schema';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runThemeCapture } from '../src/entrypoints/sidepanel/extras';
import { NO_EXTRAS, useStore } from '../src/entrypoints/sidepanel/store';
import { Scan } from '../src/entrypoints/sidepanel/views/Scan';
import { type FakeChrome, installChrome } from './helpers/chrome';

const raw = (name: string) =>
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), `../../fixtures/raw/${name}.json`), 'utf8'),
  ) as RawPage;
const light = raw('stripe');
const dark = raw('linear');
const scan = extract(light, { validate: false });

type Mock = ReturnType<typeof vi.fn>;

/** A side panel whose scanned tab 5 is on the page; scan.run answers with `reply`. */
function rig(reply: () => RawPage) {
  const c = installChrome() as FakeChrome & Record<string, unknown>;
  const log: string[] = [];
  // SPC-44: nothing may reach for the DevTools protocol any more. A read is logged, never served.
  Object.defineProperty(c, 'debugger', {
    configurable: true,
    get: () => {
      log.push('chrome.debugger');
      return undefined;
    },
  });
  (c.tabs as Record<string, unknown>).get = vi.fn(async () => ({ id: 5, url: scan.url }));
  c.runtime.sendMessage = vi.fn(async () => ({
    ok: true,
    data: { raw: reply(), screenshot: '' },
  })) as never;
  useStore.setState({
    scan,
    status: 'done',
    extras: { ...NO_EXTRAS, scanId: scan.id, tabId: 5 },
  });
  return { c, log };
}

const switched = (r: RawPage, themeApplied: boolean): RawPage => ({
  ...structuredClone(r),
  hints: { themeApplied },
});

/** Only the page's own switch was used: `theme` set, nothing else, no permission asked. */
function expectClassSwitchOnly(c: FakeChrome, log: string[]) {
  for (const [msg] of (c.runtime.sendMessage as Mock).mock.calls) {
    expect(msg).toMatchObject({ type: 'scan.run', opts: { theme: 'dark', colorsOnly: true } });
    expect(Object.keys((msg as { opts: object }).opts).sort()).toEqual(
      ['colorsOnly', 'noScreenshot', 'theme'].sort(),
    );
  }
  expect(c.permissions.request).not.toHaveBeenCalled();
  expect(c.permissions.contains).not.toHaveBeenCalled();
  expect(log).toEqual([]);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('runThemeCapture (no permission, SPC-44)', () => {
  const darkSwitch: RawHints = { darkSelectors: ['.dark'] };

  it('T5.13 a class switch that changes the page: measured, and the variant is attached', async () => {
    const { c, log } = rig(() => switched(dark, true));
    await runThemeCapture(scan, 5, darkSwitch);
    expect(useStore.getState().extras.theme).toBe('measured');
    expect(useStore.getState().scan?.variants?.dark?.measured).toBe(true);
    expectClassSwitchOnly(c, log);
  });

  it('T5.13 a class switch that did not apply, or left the page the same: no variant', async () => {
    for (const reply of [() => switched(dark, false), () => switched(light, true)]) {
      const { c, log } = rig(reply);
      await runThemeCapture(scan, 5, darkSwitch);
      expect(useStore.getState().extras.theme).toBe('none');
      expect(useStore.getState().scan?.variants?.dark).toBeUndefined();
      expectClassSwitchOnly(c, log);
    }
  });

  it('T5.13 a page that only follows the OS setting: "system", nothing sampled, no permission', async () => {
    const { c, log } = rig(() => switched(dark, true));
    await runThemeCapture(scan, 5, { prefersScheme: true });
    expect(useStore.getState().extras.theme).toBe('system');
    expect(c.runtime.sendMessage).not.toHaveBeenCalled();
    expect(useStore.getState().scan?.variants?.dark).toBeUndefined();
    expectClassSwitchOnly(c, log);
  });

  it('T5.13 a failed class switch on a page with OS-only rules too: "system"', async () => {
    const { c, log } = rig(() => {
      throw new Error('sampler failed');
    });
    await runThemeCapture(scan, 5, { ...darkSwitch, prefersScheme: true });
    expect(useStore.getState().extras.theme).toBe('system');
    expectClassSwitchOnly(c, log);
  });

  it('T5.13 neither a switch nor OS rules: "none"', async () => {
    const { c } = rig(() => switched(dark, true));
    await runThemeCapture(scan, 5, {});
    expect(useStore.getState().extras.theme).toBe('none');
    expect(c.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('Scan card: OS-only dark mode', () => {
  it('T5.13 says "not measured", with no capture button and no permission text', async () => {
    rig(() => light);
    useStore.setState({ extras: { ...NO_EXTRAS, scanId: scan.id, tabId: 5, theme: 'system' } });
    render(<Scan />);
    const text = await screen.findByText('follows your system setting · not measured');
    expect(screen.getByText(/derived from the measured one/)).toBeTruthy();
    // The row (label + value) has no capture control.
    const row = text.closest('div') as HTMLElement;
    expect(within(row).queryByRole('button')).toBeNull();
    expect(screen.queryByText(/permission|debugging/i)).toBeNull();
  });
});

describe('scan.run from an old caller (SPC-44)', () => {
  /** Boot the real background entrypoint and return its runtime.onMessage listener. */
  async function background() {
    const c = installChrome() as FakeChrome & Record<string, unknown>;
    const log: string[] = [];
    Object.defineProperty(c, 'debugger', {
      configurable: true,
      get: () => {
        log.push('chrome.debugger');
        return undefined;
      },
    });
    const noEvent = () => ({ addListener: vi.fn() });
    const onMessage = noEvent();
    Object.assign(c, {
      commands: { onCommand: noEvent() },
      sidePanel: { setPanelBehavior: vi.fn(async () => {}), open: vi.fn(async () => {}) },
      action: {
        setBadgeText: vi.fn(async () => {}),
        setBadgeBackgroundColor: vi.fn(async () => {}),
      },
      scripting: {
        executeScript: vi.fn(async (inj: { files?: string[] }) =>
          inj.files ? [{ result: structuredClone(light) }] : [{ result: undefined }],
        ),
      },
    });
    Object.assign(c.runtime, { onMessage, onStartup: noEvent(), onInstalled: noEvent() });
    (c.tabs as Record<string, unknown>).get = vi.fn(async () => ({ id: 7, url: light.url }));
    vi.stubGlobal('__SPECIMEN_E2E__', false);
    vi.stubGlobal('defineBackground', (main: () => void) => main);
    vi.resetModules();
    const mod = await import('../src/entrypoints/background');
    (mod.default as unknown as () => void)();
    const listener = onMessage.addListener.mock.calls[0]?.[0] as (
      msg: unknown,
      sender: unknown,
      reply: (r: unknown) => void,
    ) => boolean;
    return { c, log, listener };
  }

  beforeEach(() => vi.useRealTimers());

  it('T5.13 a stray `emulate` opt is ignored: a normal sample, never an error or a debugger call', async () => {
    const { c, log, listener } = await background();
    const reply = vi.fn();
    const msg = { type: 'scan.run', tabId: 7, opts: { emulate: 'dark', noScreenshot: true } };
    expect(listener(msg, {}, reply)).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    const res = reply.mock.calls[0]?.[0] as { ok: boolean; data?: { raw: RawPage } };
    expect(res.ok).toBe(true);
    expect(res.data?.raw.url).toBe(light.url);
    // The sampler got only the options it knows; `emulate` is not passed on.
    const setOpts = (c.scripting as { executeScript: Mock }).executeScript.mock.calls[0]?.[0] as {
      args: [Record<string, unknown>];
    };
    expect(setOpts.args[0]).not.toHaveProperty('emulate');
    expect(log).toEqual([]);
    expect(c.permissions.request).not.toHaveBeenCalled();
  });
});
