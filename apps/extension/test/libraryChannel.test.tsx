// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { DesignScan } from '@specimen/core/schema';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { Library } from '../src/entrypoints/sidepanel/views/Library';
import {
  db,
  deleteScans,
  importScans,
  replaceStoredScan,
  saveCompose,
  saveScan,
  updateScan,
} from '../src/lib/db';
import { notifyLibraryChanged, onLibraryChanged } from '../src/lib/libraryChannel';
import { installChrome } from './helpers/chrome';

// A 1×1 PNG, so each scan also gets a thumbnail row.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const scanOf = (id: string, over: Partial<DesignScan> = {}): DesignScan => ({
  ...sampleScan,
  id,
  host: `${id}.test`,
  url: `https://${id}.test/`,
  scannedAt: 1,
  ...over,
});

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** Every ping on the channel, as another panel would see it. */
function listen() {
  const seen: unknown[] = [];
  const ch = new BroadcastChannel('specimen-library');
  ch.onmessage = (e) => seen.push(e.data);
  return { seen, close: () => ch.close() };
}

let urls: { created: string[]; revoked: string[] };

beforeEach(async () => {
  installChrome();
  useStore.setState({ scan: null, status: 'idle', activeTab: 'library' });
  await Promise.all([db.scans.clear(), db.thumbs.clear(), db.chats.clear(), db.composes.clear()]);
  urls = { created: [], revoked: [] };
  let n = 0;
  // fake-indexeddb hands the thumbnail back as a plain object, which jsdom's URL rejects.
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const u = `blob:thumb-${++n}`;
    urls.created.push(u);
    return u;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => {
    urls.revoked.push(u);
  });
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Library change ping (unit, SPC-43)', () => {
  it('T4.14 a burst of pings calls back once; foreign messages are ignored', async () => {
    const cb = vi.fn();
    const off = onLibraryChanged(cb, { debounceMs: 40 });
    const other = new BroadcastChannel('specimen-library');
    other.postMessage('library-changed');
    other.postMessage({ type: 'other' });
    other.postMessage(null);
    await tick(80);
    expect(cb).not.toHaveBeenCalled();
    notifyLibraryChanged();
    notifyLibraryChanged();
    notifyLibraryChanged();
    await tick(100);
    expect(cb).toHaveBeenCalledOnce();
    off();
    other.close();
  });

  it('T4.14 unsubscribe closes the channel, drops a pending call and is idempotent', async () => {
    const close = vi.spyOn(BroadcastChannel.prototype, 'close');
    const cb = vi.fn();
    const off = onLibraryChanged(cb, { debounceMs: 40 });
    notifyLibraryChanged();
    await tick(10); // the ping arrived, the debounce is pending
    off();
    off();
    expect(close).toHaveBeenCalledOnce();
    notifyLibraryChanged();
    await tick(100);
    expect(cb).not.toHaveBeenCalled();
  });

  it('T4.14 with no BroadcastChannel, pinging and subscribing are no-ops', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    expect(() => notifyLibraryChanged()).not.toThrow();
    const off = onLibraryChanged(() => {});
    expect(() => off()).not.toThrow();
  });

  it('T4.14 a ping that fails to send never fails the write', async () => {
    vi.spyOn(BroadcastChannel.prototype, 'postMessage').mockImplementation(() => {
      throw new DOMException('closed', 'InvalidStateError');
    });
    await expect(saveScan(scanOf('a'), null)).resolves.toBeTruthy();
    await expect(deleteScans(['a'])).resolves.toBeUndefined();
  });

  it('T4.14 every Library write pings after it commits; the message carries no data', async () => {
    const l = listen();
    const step = async (work: () => Promise<unknown>) => {
      const before = l.seen.length;
      await work();
      await tick();
      return l.seen.length - before;
    };
    expect(await step(() => saveScan(scanOf('a'), null))).toBe(1);
    expect(await step(() => updateScan('a', { title: 'Renamed' }))).toBe(1);
    expect(await step(() => updateScan('a', { tags: ['x'] }))).toBe(1);
    expect(await step(() => updateScan('a', { favorite: true }))).toBe(1);
    expect(await step(() => replaceStoredScan({ ...scanOf('a'), title: 'Merged' }))).toBe(1);
    expect(await step(() => importScans([scanOf('b')]))).toBe(1);
    expect(
      await step(() =>
        saveCompose(
          {
            id: 'c',
            name: 'c',
            sources: { colors: 'a', typography: 'a', spacing: 'a', shape: 'a', layout: 'a' },
            createdAt: 1,
          },
          scanOf('c'),
        ),
      ),
    ).toBe(1);
    expect(await step(() => deleteScans(['a']))).toBe(1);
    expect(new Set(l.seen.map((m) => JSON.stringify(m)))).toEqual(
      new Set([JSON.stringify({ type: 'library-changed' })]),
    );
    l.close();
  });

  it('T4.14 a write that throws, a missing row or a duplicates-only import sends no ping', async () => {
    await saveScan(scanOf('a'), null);
    await tick();
    const l = listen();
    const badHex = scanOf('bad');
    badHex.colors = {
      ...badHex.colors,
      palette: badHex.colors.palette.map((t, i) => (i === 0 ? { ...t, hex: 'zzz' } : t)),
    };
    await expect(saveScan(badHex, null)).rejects.toThrow();
    await expect(replaceStoredScan(badHex)).rejects.toThrow();
    const dark = { roles: { background: 'no-such-id' } } as never;
    await expect(updateScan('a', { variants: { dark } })).rejects.toThrow();
    await updateScan('gone', { title: 'x' });
    expect(await importScans([scanOf('a')])).toEqual({ imported: 0, duplicates: 1 });
    await tick(60);
    expect(l.seen).toEqual([]);
    l.close();
  });
});

describe('Two side panels (component, SPC-43)', () => {
  const seed = async () => {
    await saveScan(scanOf('1', { title: 'Stripe' }), PNG);
    await saveScan(scanOf('2', { title: 'Linear' }), PNG);
    await saveScan(scanOf('3', { title: 'Cal' }), PNG);
    await tick(); // let the seeding pings pass before any panel listens
  };
  const titles = (panel: HTMLElement) =>
    within(panel)
      .queryAllByTestId('library-card')
      .map((c) => c.querySelector('.truncate')?.textContent)
      .sort();
  const cardIn = (panel: HTMLElement, title: string) =>
    within(panel)
      .getAllByTestId('library-card')
      .find((c) => c.textContent?.includes(title)) as HTMLElement;

  async function twoPanels() {
    const a = render(<Library />).container;
    const b = render(<Library />).container;
    await waitFor(() => {
      expect(titles(a)).toEqual(['Cal', 'Linear', 'Stripe']);
      expect(titles(b)).toEqual(['Cal', 'Linear', 'Stripe']);
    });
    return { a, b };
  }

  it('T4.14 a delete in one panel makes the card disappear in the other', async () => {
    await seed();
    const { a, b } = await twoPanels();
    fireEvent.click(within(a).getByRole('button', { name: 'Delete Linear' }));
    await waitFor(() => expect(titles(a)).toEqual(['Cal', 'Stripe']));
    await waitFor(() => expect(titles(b)).toEqual(['Cal', 'Stripe']));
  });

  it('T4.14 a rename, a favourite and a new scan show in the other panel', async () => {
    await seed();
    const { a, b } = await twoPanels();
    fireEvent.click(within(cardIn(a, 'Linear')).getByRole('button', { name: 'More actions' }));
    fireEvent.click(within(a).getByRole('menuitem', { name: 'Rename' }));
    const box = within(a).getByLabelText('Title');
    fireEvent.change(box, { target: { value: 'Linear app' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(titles(b)).toEqual(['Cal', 'Linear app', 'Stripe']));

    fireEvent.click(within(cardIn(a, 'Cal')).getByRole('button', { name: 'More actions' }));
    fireEvent.click(within(a).getByRole('menuitem', { name: 'Favorite' }));
    await waitFor(() => expect(cardIn(b, 'Cal').querySelector('svg.fill-current')).toBeTruthy());

    await saveScan(scanOf('4', { title: 'Vercel' }), null); // a scan finished in another window
    await waitFor(() => expect(titles(a)).toContain('Vercel'));
    await waitFor(() => expect(titles(b)).toContain('Vercel'));
  });

  it('T4.14 a write elsewhere never loses a rename being typed in this panel', async () => {
    await seed();
    const { a, b } = await twoPanels();
    fireEvent.click(within(cardIn(b, 'Linear')).getByRole('button', { name: 'More actions' }));
    fireEvent.click(within(b).getByRole('menuitem', { name: 'Rename' }));
    const box = within(b).getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Half-typed' } });
    expect(document.activeElement).toBe(box);

    // Another window deletes a different scan (its focus can't touch this document).
    await deleteScans(['3']);
    await waitFor(() => expect(within(b).getAllByTestId('library-card')).toHaveLength(2));
    expect(titles(b)).toEqual(['Stripe', undefined]); // the card being edited shows its input
    const still = within(b).getByLabelText('Title') as HTMLInputElement;
    expect(still).toBe(box);
    expect(still.value).toBe('Half-typed');
    expect(document.activeElement).toBe(still);
    expect((await db.scans.get('2'))?.title).toBe('Linear'); // nothing committed early

    fireEvent.keyDown(still, { key: 'Enter' });
    await waitFor(async () => expect((await db.scans.get('2'))?.title).toBe('Half-typed'));
    await waitFor(() => expect(titles(a)).toEqual(['Half-typed', 'Stripe']));
  });

  it('T4.14 a burst of pings leaks no thumbnail URLs; unmount closes the channel', async () => {
    await seed();
    const close = vi.spyOn(BroadcastChannel.prototype, 'close');
    const view = render(<Library />);
    await waitFor(() => expect(titles(view.container)).toHaveLength(3));
    for (let i = 0; i < 5; i++) {
      notifyLibraryChanged();
      await tick(i % 2 ? 10 : 200); // some pings collapse, some re-list
    }
    await tick(250);
    const live = urls.created.filter((u) => !urls.revoked.includes(u));
    expect(urls.created.length).toBeGreaterThan(3); // it did re-list
    expect(live).toHaveLength(3);
    const shown = [...view.container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(shown.sort()).toEqual([...live].sort());

    view.unmount();
    expect(close).toHaveBeenCalled();
    expect(urls.created.filter((u) => !urls.revoked.includes(u))).toEqual([]);
    notifyLibraryChanged();
    await tick(200); // a ping after unmount re-lists nothing
    expect(urls.created.filter((u) => !urls.revoked.includes(u))).toEqual([]);
  });
});
