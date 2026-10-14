// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { DesignScan } from '@specimen/core/schema';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/entrypoints/sidepanel/App';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { memoKey, restorePanel } from '../src/entrypoints/sidepanel/restore';
import { NO_EXTRAS, useStore } from '../src/entrypoints/sidepanel/store';
import { db, saveChat, saveScan } from '../src/lib/db';
import { type FakeChrome, fakeProvider, installChrome } from './helpers/chrome';

let chrome: FakeChrome;
const HOUR = 60 * 60 * 1000;
const URL_A = 'https://a.test/pricing';

const scanOf = (id: string, url: string, over: Partial<DesignScan> = {}): DesignScan => ({
  ...sampleScan,
  id,
  url,
  host: new URL(url).host,
  scannedAt: Date.now(),
  ...over,
});

/** The active tab of the panel's window. */
const onTab = (url: string | undefined, id = 7, windowId = 1) =>
  chrome.tabs.query.mockResolvedValue([{ id, windowId, url, active: true }] as never);

const fresh = () =>
  useStore.setState({
    scan: null,
    status: 'idle',
    error: null,
    activeTab: 'scan',
    askMode: 'quick',
    chats: {},
    offer: null,
    extras: NO_EXTRAS,
  });

beforeEach(async () => {
  chrome = installChrome();
  // The scrub ran long ago on this "install".
  chrome.storage.local.data.set('migrations.chatScrub', 1);
  Element.prototype.scrollIntoView = vi.fn();
  (globalThis as { __specimenProvider?: unknown }).__specimenProvider = fakeProvider();
  await Promise.all([db.scans.clear(), db.thumbs.clear(), db.chats.clear()]);
  fresh();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as { __specimenProvider?: unknown }).__specimenProvider;
});

describe('T4.10 the side panel restores its last state on reopen', () => {
  it('T4.10 same page: the scan, the tab and the Ask history come back', async () => {
    await saveScan(scanOf('s1', URL_A), null);
    await saveChat('s1', [
      { role: 'user', content: 'What is the accent?' },
      { role: 'assistant', content: 'It is #5e6ad2.' },
    ]);
    chrome.storage.session.data.set(memoKey(1), {
      scanId: 's1',
      activeTab: 'ask',
      askMode: 'quick',
      at: Date.now(),
    });
    onTab(`${URL_A}#plans`);
    render(<App />);
    expect((await screen.findByTestId('ask-assistant')).textContent).toBe('It is #5e6ad2.');
    expect(screen.getByTestId('ask-user').textContent).toBe('What is the accent?');
    expect(useStore.getState().scan?.id).toBe('s1');
    expect(useStore.getState().origin).toBe('tab');
    expect(useStore.getState().extras.tabId).toBe(7);
  });

  it('T4.10 no memo (browser restarted): the newest fresh scan of this page opens on Inspect', async () => {
    await saveScan(scanOf('old', URL_A, { scannedAt: Date.now() - 2 * HOUR }), null);
    await saveScan(scanOf('new', URL_A, { scannedAt: Date.now() - HOUR }), null);
    await saveScan(scanOf('other', 'https://a.test/blog'), null);
    onTab(URL_A);
    await restorePanel();
    expect(useStore.getState().scan?.id).toBe('new');
    expect(useStore.getState().activeTab).toBe('inspect');
  });

  it('T4.10 a different page or site: no stale scan, even when the memo points elsewhere', async () => {
    await saveScan(scanOf('s1', URL_A), null);
    chrome.storage.session.data.set(memoKey(1), {
      scanId: 's1',
      activeTab: 'generate',
      askMode: 'quick',
      at: Date.now(),
    });
    for (const url of ['https://a.test/blog', 'https://b.test/pricing']) {
      fresh();
      onTab(url);
      await restorePanel();
      expect(useStore.getState().scan).toBeNull();
      expect(useStore.getState().activeTab).toBe('scan');
      expect(useStore.getState().offer).toBeNull();
    }
  });

  it('T4.10 a scan of this page older than 24 h is not restored', async () => {
    await saveScan(scanOf('s1', URL_A, { scannedAt: Date.now() - 25 * HOUR }), null);
    onTab(URL_A);
    await restorePanel();
    expect(useStore.getState().scan).toBeNull();
  });

  it('T4.10 empty Library: nothing restored, the scan prompt shows', async () => {
    onTab(URL_A);
    render(<App />);
    await waitFor(() => expect(chrome.tabs.query).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByTestId('scan-empty')).toBeTruthy();
    expect(screen.queryByTestId('last-scan-offer')).toBeNull();
  });

  it('T4.10 the memo points to a scan deleted from the Library: falls back to the page lookup', async () => {
    await saveScan(scanOf('kept', URL_A, { scannedAt: Date.now() - HOUR }), null);
    chrome.storage.session.data.set(memoKey(1), {
      scanId: 'deleted',
      activeTab: 'ask',
      askMode: 'council',
      at: Date.now(),
    });
    onTab(URL_A);
    await restorePanel();
    expect(useStore.getState().scan?.id).toBe('kept');
    expect(useStore.getState().activeTab).toBe('inspect');
    expect(useStore.getState().askMode).toBe('quick');
  });

  it('T4.10 a Library error: the panel opens empty without throwing', async () => {
    await saveScan(scanOf('s1', URL_A), null);
    vi.spyOn(db.scans, 'where').mockImplementation(() => {
      throw new Error('IndexedDB broke');
    });
    onTab(URL_A);
    await expect(restorePanel()).resolves.toBe(1);
    expect(useStore.getState().scan).toBeNull();
  });

  it('T4.10 session storage failing: restores by page only, on Inspect', async () => {
    await saveScan(scanOf('s1', URL_A), null);
    chrome.storage.session.get.mockRejectedValue(new Error('no session'));
    onTab(URL_A);
    await restorePanel();
    expect(useStore.getState().scan?.id).toBe('s1');
    expect(useStore.getState().activeTab).toBe('inspect');
  });

  it('T4.10 a scan the user started meanwhile is never overwritten', async () => {
    await saveScan(scanOf('s1', URL_A), null);
    onTab(URL_A);
    const p = restorePanel();
    useStore.getState().start();
    await p;
    expect(useStore.getState().scan).toBeNull();
    expect(useStore.getState().status).toBe('scanning');
  });

  it('T4.10 page unknown (no site access yet): the last scan is offered, not applied', async () => {
    await saveScan(scanOf('s1', URL_A), null);
    onTab(undefined);
    render(<App />);
    const offer = await screen.findByTestId('last-scan-offer');
    expect(offer.textContent).toContain('a.test');
    expect(useStore.getState().scan).toBeNull();
    fireEvent.click(offer);
    await waitFor(() => expect(useStore.getState().scan?.id).toBe('s1'));
    expect(useStore.getState().origin).toBe('saved');
    expect(useStore.getState().offer).toBeNull();
  });

  it('T4.10 each window keeps its own memo; window 2 does not take window 1 tab', async () => {
    await saveScan(scanOf('s1', URL_A), null);
    chrome.storage.session.data.set(memoKey(1), {
      scanId: 's1',
      activeTab: 'generate',
      askMode: 'quick',
      at: Date.now(),
    });
    onTab('https://b.test/', 9, 2);
    await restorePanel();
    expect(useStore.getState().scan).toBeNull();
    // Same page in window 2 with no memo there: the Library lookup finds it, on Inspect.
    fresh();
    onTab(URL_A, 9, 2);
    await restorePanel();
    expect(useStore.getState().scan?.id).toBe('s1');
    expect(useStore.getState().activeTab).toBe('inspect');
  });

  it('T4.10 the panel remembers the scan and tab per window, with no page text', async () => {
    await saveScan(scanOf('s1', URL_A), null);
    onTab(URL_A, 7, 3);
    render(<App />);
    await waitFor(() => expect(useStore.getState().scan?.id).toBe('s1'));
    act(() => useStore.getState().setTab('generate'));
    await waitFor(() =>
      expect(chrome.storage.session.data.get(memoKey(3))).toMatchObject({
        scanId: 's1',
        activeTab: 'generate',
      }),
    );
    expect(Object.keys(chrome.storage.session.data.get(memoKey(3)) as object).sort()).toEqual([
      'activeTab',
      'askMode',
      'at',
      'scanId',
    ]);
  });
});
