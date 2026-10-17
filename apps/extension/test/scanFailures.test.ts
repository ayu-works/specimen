// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RawPage } from '@specimen/core/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTabScan } from '../src/entrypoints/sidepanel/runScan';
import { NO_EXTRAS, useStore } from '../src/entrypoints/sidepanel/store';
import { cssFetch, ensureOffscreen, scanRun } from '../src/lib/backgroundScan';
import { db } from '../src/lib/db';
import { listen, send } from '../src/lib/messaging';
import { friendlyScanError, scanTab } from '../src/lib/scanFlow';
import { type FakeChrome, installChrome } from './helpers/chrome';

const rawFixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), '../../fixtures/raw/stripe.json'), 'utf8'),
) as RawPage;

const SITE_ACCESS =
  'Specimen needs permission to read the page you scan. Click Scan again and choose Allow.';
const RESTRICTED =
  "Can't scan chrome:// pages or the Chrome Web Store. Open a regular website and try again.";

/** The background's chrome APIs that `scanRun` touches, on top of the shared fake. */
interface BgChrome {
  tabs: FakeChrome['tabs'] & {
    get: ReturnType<typeof vi.fn>;
    captureVisibleTab: ReturnType<typeof vi.fn>;
  };
  scripting: { executeScript: ReturnType<typeof vi.fn> };
  runtime: FakeChrome['runtime'] & { onMessage: { addListener: ReturnType<typeof vi.fn> } };
  offscreen: { createDocument: ReturnType<typeof vi.fn> };
}

let chrome: FakeChrome & BgChrome;

/** A tab whose `active` flag can be flipped between calls to `tabs.get`. */
let tabState: { id: number; windowId: number; url: string; active: boolean } | null;

beforeEach(async () => {
  const c = installChrome() as FakeChrome & Partial<BgChrome>;
  tabState = { id: 7, windowId: 1, url: 'https://stripe.com/', active: true };
  Object.assign(c.tabs, {
    get: vi.fn(async (id: number) => {
      if (!tabState || tabState.id !== id) throw new Error(`No tab with id: ${id}.`);
      return { ...tabState };
    }),
    captureVisibleTab: vi.fn(async () => {
      throw new Error('captureVisibleTab is not stubbed for this test');
    }),
  });
  c.scripting = {
    executeScript: vi.fn(async (inj: { files?: string[] }) =>
      inj.files ? [{ result: structuredClone(rawFixture) }] : [{ result: undefined }],
    ),
  };
  c.offscreen = { createDocument: vi.fn(async () => undefined) };
  Object.assign(c.runtime, { onMessage: { addListener: vi.fn() } });
  chrome = c as FakeChrome & BgChrome;
  // The panel talks to a "background" that runs the real scanRun in the same process.
  chrome.runtime.sendMessage = vi.fn(async (msg: { tabId: number; opts?: object }) => {
    try {
      return { ok: true, data: await scanRun(msg.tabId, msg.opts) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }) as never;
  chrome.tabs.query.mockResolvedValue([{ ...tabState }] as never);
  await Promise.all([db.scans.clear(), db.thumbs.clear()]);
  useStore.setState({
    scan: null,
    status: 'idle',
    error: null,
    saveError: null,
    extras: NO_EXTRAS,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('friendlyScanError (audit H8)', () => {
  it.each([
    ['Unsupported page: chrome://settings/', RESTRICTED],
    ['Cannot access a chrome:// URL', RESTRICTED],
    ['The extensions gallery cannot be scripted.', RESTRICTED],
    ['Unsupported page: file:///Users/x/a.html', /only scan websites \(http or https\)/],
    ['Unsupported page: about:blank', /only scan websites/],
    ['Unsupported page: file:///Users/x/webstore.html', /only scan websites/],
    ['Unsupported page: chrome-extension://abc/x.html', RESTRICTED],
    ['No active tab', 'No active tab to scan.'],
    ['Site access declined', SITE_ACCESS],
    ['This function must be called during a user gesture', SITE_ACCESS],
    ['Cannot access contents of url "https://a.test/". Missing host permission', SITE_ACCESS],
    ['No tab with id: 7.', 'The tab was closed before the scan finished.'],
    ['The tab was closed', 'The tab was closed before the scan finished.'],
    [
      'Could not establish connection. Receiving end does not exist.',
      "Specimen's background worker stopped. Click Scan again.",
    ],
    ['no response for scan.run', "Specimen's background worker stopped. Click Scan again."],
    ['Frame with ID 0 is showing error page', "This page didn't load. Reload it and scan again."],
    ['sampler returned no result', "Couldn't read this page. Reload it and scan again."],
    ['something odd', 'Scan failed: something odd'],
  ])('T1.11 %s', (msg, want) => {
    if (typeof want === 'string') expect(friendlyScanError(msg)).toBe(want);
    else expect(friendlyScanError(msg)).toMatch(want);
  });
});

describe('runTabScan failures end in a clear error and no Library row (audit H8)', () => {
  async function expectFailure(text: string | RegExp) {
    await runTabScan();
    const s = useStore.getState();
    expect(s.status).toBe('error');
    expect(s.scan).toBeNull();
    if (typeof text === 'string') expect(s.error).toBe(text);
    else expect(s.error).toMatch(text);
    expect(await db.scans.count()).toBe(0);
  }

  it('T1.11 site access declined', async () => {
    chrome.permissions.contains.mockResolvedValue(false);
    chrome.permissions.request.mockResolvedValue(false);
    await expectFailure(SITE_ACCESS);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('T1.11 a chrome:// page is refused before anything is injected', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 7, url: 'chrome://settings/' }] as never);
    await expectFailure(RESTRICTED);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('T1.11 a file:// page gets the http(s)-only message', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 7, url: 'file:///tmp/a.html' }] as never);
    await expectFailure(/only scan websites/);
  });

  it('T1.11 the Chrome Web Store refuses the injection', async () => {
    chrome.scripting.executeScript.mockRejectedValue(
      new Error('The extensions gallery cannot be scripted.'),
    );
    await expectFailure(RESTRICTED);
  });

  it('T1.11 the tab is closed mid-scan', async () => {
    chrome.scripting.executeScript.mockImplementation(async () => {
      tabState = null;
      throw new Error('No tab with id: 7.');
    });
    await expectFailure('The tab was closed before the scan finished.');
  });

  it('T1.11 the page shows an error page', async () => {
    chrome.scripting.executeScript.mockRejectedValue(
      new Error('Frame with ID 0 is showing error page'),
    );
    await expectFailure("This page didn't load. Reload it and scan again.");
  });

  it('T1.11 the sampler returns nothing', async () => {
    chrome.scripting.executeScript.mockResolvedValue([{ result: undefined }]);
    await expectFailure("Couldn't read this page. Reload it and scan again.");
  });

  it('T1.11 the background worker is gone (audit M9)', async () => {
    chrome.runtime.sendMessage = vi.fn(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }) as never;
    await expectFailure("Specimen's background worker stopped. Click Scan again.");
  });

  it('T1.11 the background answers nothing (audit M9)', async () => {
    chrome.runtime.sendMessage = vi.fn(async () => undefined) as never;
    await expectFailure("Specimen's background worker stopped. Click Scan again.");
  });

  it('T1.11 no active tab', async () => {
    chrome.tabs.query.mockResolvedValue([] as never);
    await expectFailure('No active tab to scan.');
  });
});

describe('a failed screenshot leaves a working, saved scan (audit H9)', () => {
  async function expectSavedWithoutThumb(warning: RegExp) {
    const out = await scanTab(7);
    expect(out.screenshot).toBe('');
    expect(out.scan.host).toBe('stripe.com');
    expect(out.scan.meta.warnings.some((w) => warning.test(w))).toBe(true);
    expect(out.saveError).toBeNull();
    expect(await db.scans.count()).toBe(1);
    expect(await db.thumbs.count()).toBe(0);
  }

  it('T1.11 captureVisibleTab rejects', async () => {
    chrome.tabs.captureVisibleTab.mockRejectedValue(new Error('Cannot capture this tab'));
    await expectSavedWithoutThumb(/^screenshot unavailable: Cannot capture this tab/);
  });

  it('T1.11 a tab that is not in front is never captured (it would shoot another tab)', async () => {
    if (tabState) tabState.active = false;
    await expectSavedWithoutThumb(/^screenshot unavailable: the tab was not in front/);
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('T1.11 a tab that goes to the background during the capture drops the shot', async () => {
    chrome.tabs.captureVisibleTab.mockImplementation(async () => {
      if (tabState) tabState.active = false; // the user switched tabs while we were capturing
      return 'data:image/jpeg;base64,AAAA';
    });
    await expectSavedWithoutThumb(/^screenshot unavailable: the tab was not in front/);
  });

  it('T1.11 the tab closes right after sampling: the scan is kept, with no shot', async () => {
    chrome.scripting.executeScript.mockImplementation(async (inj: { files?: string[] }) => {
      if (!inj.files) return [{ result: undefined }];
      tabState = null; // closed while the sampler ran
      return [{ result: structuredClone(rawFixture) }];
    });
    await expectSavedWithoutThumb(/^screenshot unavailable: No tab with id: 7/);
  });

  it('T1.11 noScreenshot never captures', async () => {
    const out = await scanRun(7, { noScreenshot: true });
    expect(out.screenshot).toBe('');
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('T1.11 a failed injection rejects with no half result', async () => {
    chrome.scripting.executeScript.mockRejectedValue(new Error('Cannot access contents of url'));
    await expect(scanRun(7)).rejects.toThrow('Cannot access contents of url');
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('T1.11 a tab that is already gone rejects before injecting', async () => {
    tabState = null;
    await expect(scanRun(7)).rejects.toThrow('No tab with id: 7.');
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe('css.fetch in the background (audit H11)', () => {
  const ok = (body: string) => ({ ok: true, status: 200, text: async (): Promise<string> => body });

  it('T1.12 no site access: skipped with that reason and never fetched', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    chrome.permissions.contains.mockResolvedValue(false);
    expect(await cssFetch(['https://cdn.test/a.css'])).toEqual([{ skipped: 'no site access' }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('T1.12 a 404, a network error and a non-http URL each give their own reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        if (u.endsWith('/missing.css'))
          return {
            ok: false,
            status: 404,
            statusText: 'Not <b>Found</b>',
            text: async (): Promise<string> => '',
          };
        if (u.endsWith('/down.css')) throw new TypeError('net::ERR_NAME_NOT_RESOLVED secret.test');
        return ok(':root{--a:1}');
      }),
    );
    const texts = await cssFetch([
      'https://cdn.test/missing.css',
      'https://cdn.test/down.css',
      'ftp://cdn.test/a.css',
      'not a url',
      'https://cdn.test/good.css',
    ]);
    // Fixed strings only: no status text or error message from the network.
    expect(texts).toEqual([
      { skipped: 'HTTP 404' },
      { skipped: 'network error' },
      { skipped: 'not http(s)' },
      { skipped: 'not http(s)' },
      ':root{--a:1}',
    ]);
  });

  it('T1.12 fetches at most 24 stylesheets and says why the rest were skipped', async () => {
    const fetch = vi.fn(async () => ok(''));
    vi.stubGlobal('fetch', fetch);
    const urls = Array.from({ length: 25 }, (_, i) => `https://cdn.test/${i}.css`);
    const texts = await cssFetch(urls);
    expect(fetch).toHaveBeenCalledTimes(24);
    expect(texts).toHaveLength(25);
    expect(texts[24]).toEqual({ skipped: 'over the 24-stylesheet limit' });
  });

  it('T1.12 cuts a stylesheet at 2,000,000 characters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok('a'.repeat(3_000_000))),
    );
    const [text] = await cssFetch(['https://cdn.test/big.css']);
    expect(text).toHaveLength(2_000_000);
  });
});

describe('messaging and the offscreen document (audit M9)', () => {
  it('T1.11 (M9) send throws the background error, or "no response" when nothing answers', async () => {
    chrome.runtime.sendMessage = vi.fn(async () => ({ ok: false, error: 'boom' })) as never;
    await expect(send('scan.run', { tabId: 1 })).rejects.toThrow('boom');
    chrome.runtime.sendMessage = vi.fn(async () => undefined) as never;
    await expect(send('scan.run', { tabId: 1 })).rejects.toThrow('no response for scan.run');
  });

  it('T1.11 (M9) listen answers an unknown type with "not implemented"', () => {
    listen({});
    const handler = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const reply = vi.fn();
    expect(handler({ type: 'overlay.set' }, {}, reply)).toBe(false);
    expect(reply).toHaveBeenCalledWith({ ok: false, error: 'not implemented: overlay.set' });
  });

  it('T1.11 (M9) listen turns a handler rejection into an error reply', async () => {
    listen({ 'scan.run': async () => Promise.reject(new Error('nope')) });
    const handler = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const reply = vi.fn();
    expect(handler({ type: 'scan.run', tabId: 1 }, {}, reply)).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: false, error: 'nope' }));
  });

  it('T1.11 (M9) ensureOffscreen creates nothing when the document exists', async () => {
    chrome.runtime.getContexts.mockResolvedValue([{}] as never);
    expect(await ensureOffscreen()).toBe(false);
    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it('T1.11 (M9) ensureOffscreen treats a lost creation race as success', async () => {
    chrome.offscreen.createDocument.mockRejectedValue(
      new Error('Only a single offscreen document may be created.'),
    );
    expect(await ensureOffscreen()).toBe(false);
  });

  it('T1.11 (M9) ensureOffscreen rethrows any other error', async () => {
    chrome.offscreen.createDocument.mockRejectedValue(new Error('bad reason'));
    await expect(ensureOffscreen()).rejects.toThrow('bad reason');
  });

  it('T1.11 (M9) ensureOffscreen creates the document when none exists', async () => {
    expect(await ensureOffscreen()).toBe(true);
    expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);
  });
});
