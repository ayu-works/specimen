// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RawPage } from '@specimen/core/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTabScan } from '../src/entrypoints/sidepanel/runScan';
import { NO_EXTRAS, useStore } from '../src/entrypoints/sidepanel/store';
import { Scan } from '../src/entrypoints/sidepanel/views/Scan';
import { db } from '../src/lib/db';
import { scanTab } from '../src/lib/scanFlow';
import { type FakeChrome, installChrome } from './helpers/chrome';

const raw = JSON.parse(
  readFileSync(path.resolve(process.cwd(), '../../fixtures/raw/stripe.json'), 'utf8'),
) as RawPage;

let chrome: FakeChrome;
/** Make every new scan row fail the way a full disk does (the real IDB transaction aborts). */
const quota = () => {
  throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
};

beforeEach(async () => {
  chrome = installChrome();
  chrome.runtime.sendMessage = vi.fn(async () => ({
    ok: true,
    data: { raw, screenshot: '' },
  })) as never;
  chrome.tabs.query.mockResolvedValue([
    { id: 7, windowId: 1, url: 'https://stripe.com/', active: true },
  ] as never);
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
  db.scans.hook('creating').unsubscribe(quota);
  cleanup();
  vi.restoreAllMocks();
});

describe('a scan whose Library save fails (audit H7)', () => {
  it('T4.08 (unit) scanTab still returns the scan, with the reason it was not saved', async () => {
    db.scans.hook('creating', quota);
    const out = await scanTab(7);
    expect(out.scan.host).toBe('stripe.com');
    expect(out.saveError).toMatch(/out of storage space/);
    expect(await db.scans.count()).toBe(0);
  });

  it('T4.08 (unit) the panel shows the scan as done and says it is not in the Library', async () => {
    db.scans.hook('creating', quota);
    await runTabScan();
    const s = useStore.getState();
    expect(s.status).toBe('done');
    expect(s.scan?.host).toBe('stripe.com');
    expect(s.saveError).toMatch(/out of storage space/);
    render(<Scan />);
    expect(screen.getByTestId('save-error').textContent).toMatch(/Not saved to Library/);
  });

  it('T4.08 (unit) a saved scan shows no warning', async () => {
    await runTabScan();
    expect(useStore.getState().saveError).toBeNull();
    expect(await db.scans.count()).toBe(1);
    render(<Scan />);
    expect(screen.queryByTestId('save-error')).toBeNull();
  });
});
