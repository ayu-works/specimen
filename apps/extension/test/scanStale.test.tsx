// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RawPage } from '@specimen/core/schema';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTabScan } from '../src/entrypoints/sidepanel/runScan';
import { NO_EXTRAS, useStore } from '../src/entrypoints/sidepanel/store';
import { Scan } from '../src/entrypoints/sidepanel/views/Scan';
import { db } from '../src/lib/db';
import { type FakeChrome, installChrome } from './helpers/chrome';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), `../../fixtures/raw/${name}.json`), 'utf8'),
  ) as RawPage;
const stripe = fixture('stripe');
const linear = fixture('linear');

const RESTRICTED =
  "Can't scan chrome:// pages or the Chrome Web Store. Open a regular website and try again.";

let chrome: FakeChrome;
const answer = (raw: RawPage) =>
  vi.fn(async () => ({ ok: true, data: { raw, screenshot: '' } })) as never;
const activeTab = (url: string) =>
  chrome.tabs.query.mockResolvedValue([{ id: 7, windowId: 1, url, active: true }] as never);
const quota = () => {
  throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
};

beforeEach(async () => {
  chrome = installChrome();
  chrome.runtime.sendMessage = answer(stripe);
  activeTab('https://stripe.com/');
  await Promise.all([db.scans.clear(), db.thumbs.clear()]);
  useStore.setState({
    scan: null,
    status: 'idle',
    error: null,
    saveError: null,
    extras: NO_EXTRAS,
    offer: null,
  });
});

afterEach(() => {
  db.scans.hook('creating').unsubscribe(quota);
  cleanup();
  vi.restoreAllMocks();
});

const card = () => screen.getByTestId('scan-result');

/** Scan stripe.com, then fail a scan of a chrome:// page. Returns the stripe scan's id. */
async function scanThenFail(): Promise<string> {
  await act(() => runTabScan());
  const id = useStore.getState().scan?.id as string;
  activeTab('chrome://settings/');
  await act(() => runTabScan());
  return id;
}

describe('T1.37 a failed scan labels the card below it as the previous scan (SPC-38)', () => {
  it('T1.37 a scan that works shows a plain card', async () => {
    render(<Scan />);
    await act(() => runTabScan());
    expect(card().dataset.stale).toBeUndefined();
    expect(screen.queryByTestId('previous-scan')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Re-scan' })).toBeTruthy();
  });

  it('T1.37 a scan that fails after one that worked: the old card is labelled, not passed off as the new page', async () => {
    render(<Scan />);
    const oldId = await scanThenFail();
    expect(useStore.getState().status).toBe('error');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(RESTRICTED);
    expect(alert.textContent).toContain('The card below is your previous scan.');
    expect(card().dataset.stale).toBe('true');
    expect(screen.getByTestId('previous-scan').textContent).toBe('Previous scan, not this page.');
    expect(card().textContent).toContain('stripe.com');
    expect(screen.queryByRole('button', { name: 'Re-scan' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Scan this page' })).toHaveLength(1);

    // The card's own actions still act on the previous scan, by its id (PE note).
    activeTab('https://stripe.com/pricing');
    chrome.runtime.sendMessage = answer({ ...stripe, url: 'https://stripe.com/pricing' });
    fireEvent.click(screen.getByRole('button', { name: /Add another page/ }));
    await waitFor(() => expect(useStore.getState().scan?.meta.pages).toHaveLength(2));
    expect(useStore.getState().scan?.id).toBe(oldId);
    expect((await db.scans.get(oldId))?.meta.pages).toHaveLength(2);
  });

  it('T1.37 a retry that works replaces the card with the new scan and drops the label', async () => {
    render(<Scan />);
    const oldId = await scanThenFail();
    activeTab('https://linear.app/');
    chrome.runtime.sendMessage = answer(linear);
    fireEvent.click(screen.getByRole('button', { name: 'Scan this page' }));
    await waitFor(() => expect(useStore.getState().status).toBe('done'));
    expect(useStore.getState().scan?.id).not.toBe(oldId);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('previous-scan')).toBeNull();
    expect(card().dataset.stale).toBeUndefined();
    expect(card().textContent).toContain('linear.app');
    expect(card().textContent).not.toContain('stripe.com');
    expect(screen.getByRole('button', { name: 'Re-scan' })).toBeTruthy();
  });

  it('T1.37 while the retry runs, neither the alert nor the label is shown', async () => {
    render(<Scan />);
    await scanThenFail();
    activeTab('https://stripe.com/');
    let release: (v: unknown) => void = () => {};
    const send = vi.fn(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    chrome.runtime.sendMessage = send as never;
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = runTabScan();
    });
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(useStore.getState().status).toBe('scanning');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('previous-scan')).toBeNull();
    await act(async () => {
      release({ ok: true, data: { raw: stripe, screenshot: '' } });
      await pending;
    });
    expect(useStore.getState().status).toBe('done');
  });

  it('T1.37 a failure with no earlier scan shows the alert alone', async () => {
    render(<Scan />);
    activeTab('chrome://settings/');
    await act(() => runTabScan());
    expect(screen.getByRole('alert').textContent).toBe(RESTRICTED);
    expect(screen.queryByTestId('scan-result')).toBeNull();
    expect(screen.getByTestId('scan-empty')).toBeTruthy();
  });

  it('T1.37 a previous scan that was never saved keeps its "Not saved to Library" line (#33)', async () => {
    db.scans.hook('creating', quota);
    render(<Scan />);
    await scanThenFail();
    expect(screen.getByTestId('previous-scan')).toBeTruthy();
    expect(screen.getByTestId('save-error').textContent).toMatch(/Not saved to Library/);
  });

  it('T1.37 opening a Library scan after a failure clears the label', async () => {
    render(<Scan />);
    await scanThenFail();
    const old = useStore.getState().scan;
    if (!old) throw new Error('no scan');
    act(() => useStore.getState().openScan(old, 'saved'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('previous-scan')).toBeNull();
    expect(card().dataset.stale).toBeUndefined();
  });
});
