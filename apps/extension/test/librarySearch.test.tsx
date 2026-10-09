// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { Library } from '../src/entrypoints/sidepanel/views/Library';
import { db, saveScan } from '../src/lib/db';
import { installChrome } from './helpers/chrome';

const seed = (id: string, host: string, title: string, tags: string[] = []) =>
  saveScan({ ...sampleScan, id, host, title, url: `https://${host}/`, scannedAt: 1 }, null, {
    tags,
  });

const names = () =>
  screen.queryAllByTestId('library-card').map((c) => c.querySelector('.truncate')?.textContent);

beforeEach(async () => {
  installChrome();
  useStore.setState({ scan: null, status: 'idle', activeTab: 'library' });
  await Promise.all([db.scans.clear(), db.thumbs.clear()]);
  await seed('1', 'stripe.com', 'Stripe | Payments', ['fintech', 'light']);
  await seed('2', 'linear.app', 'Linear', ['dark']);
  await seed('3', 'cal.com', 'Cal.com scheduling', []);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Library view (component)', () => {
  it('T4.07 search filters the cards by host, title and tag', async () => {
    render(<Library />);
    await waitFor(() => expect(screen.getAllByTestId('library-card')).toHaveLength(3));
    const search = screen.getByLabelText('Search the Library');
    const type = (q: string) => fireEvent.change(search, { target: { value: q } });

    // Host.
    type('linear');
    expect(names()).toEqual(['Linear']);
    // Title (case-insensitive, partial).
    type('PAYMENTS');
    expect(names()).toEqual(['Stripe | Payments']);
    // Tag.
    type('fintech');
    expect(names()).toEqual(['Stripe | Payments']);
    type('dark');
    expect(names()).toEqual(['Linear']);
    // Matches several.
    type('.com');
    expect(names()).toHaveLength(2);
    // Nothing matches: a message instead of an empty grid.
    type('zzz-nothing');
    expect(names()).toEqual([]);
    expect(screen.getByText(/No scans match "zzz-nothing"/)).toBeTruthy();
    // Clearing the box restores everything.
    type('');
    expect(screen.getAllByTestId('library-card')).toHaveLength(3);
  });
});
