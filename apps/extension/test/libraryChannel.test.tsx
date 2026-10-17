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

// The real listScans unless a test swaps in a slow or failing one.
const list = vi.hoisted(() => ({ impl: null as null | (() => Promise<unknown>) }));
vi.mock('../src/lib/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/db')>();
  return { ...real, listScans: () => (list.impl ? list.impl() : real.listScans()) };
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
  list.impl = null;
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

  it('T4.14 a burst of pings leaks no thumbnail URLs and keeps unchanged ones; unmount closes the channel', async () => {
    await seed();
    const close = vi.spyOn(BroadcastChannel.prototype, 'close');
    const view = render(<Library />);
    await waitFor(() => expect(titles(view.container)).toHaveLength(3));
    expect(urls.created).toHaveLength(3);
    const linear = cardIn(view.container, 'Linear').querySelector('img')?.getAttribute('src');
    for (let i = 0; i < 5; i++) {
      notifyLibraryChanged();
      await tick(i % 2 ? 10 : 200); // some pings collapse, some re-list
    }
    await tick(250);
    // Re-lists with no change make and revoke nothing: no image is repointed.
    expect(urls.created).toHaveLength(3);
    expect(urls.revoked).toEqual([]);
    await deleteScans(['2']);
    await saveScan(scanOf('4', { title: 'Vercel' }), PNG);
    await waitFor(() => expect(titles(view.container)).toEqual(['Cal', 'Stripe', 'Vercel']));
    expect(urls.revoked).toEqual([linear]); // only the deleted scan's URL
    expect(urls.created).toHaveLength(4); // only the new scan's URL
    const live = urls.created.filter((u) => !urls.revoked.includes(u));
    const shown = [...view.container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(shown.sort()).toEqual([...live].sort());

    view.unmount();
    expect(close).toHaveBeenCalled();
    expect(urls.created.filter((u) => !urls.revoked.includes(u))).toEqual([]);
    notifyLibraryChanged();
    await tick(200); // a ping after unmount re-lists nothing
    expect(urls.created.filter((u) => !urls.revoked.includes(u))).toEqual([]);
  });

  it('T4.14 leaving an unchanged rename or tags edit never undoes a change made in the other window', async () => {
    await seed();
    const { b } = await twoPanels();
    fireEvent.click(within(cardIn(b, 'Linear')).getByRole('button', { name: 'More actions' }));
    fireEvent.click(within(b).getByRole('menuitem', { name: 'Rename' }));
    await updateScan('2', { title: 'Linear app' }); // the other window renames it meanwhile
    await tick(250); // B re-lists while its input is still open
    fireEvent.blur(within(b).getByLabelText('Title'));
    await tick(50);
    expect((await db.scans.get('2'))?.title).toBe('Linear app');

    fireEvent.click(within(cardIn(b, 'Linear app')).getByRole('button', { name: 'More actions' }));
    fireEvent.click(within(b).getByRole('menuitem', { name: 'Tags' }));
    await updateScan('2', { tags: ['added-elsewhere'] });
    await tick(250);
    fireEvent.blur(within(b).getByLabelText('Tags, comma separated'));
    await tick(50);
    expect((await db.scans.get('2'))?.tags).toEqual(['added-elsewhere']);
  });

  it('T4.14 an older re-list that finishes last never replaces a newer one', async () => {
    await seed();
    const view = render(<Library />);
    await waitFor(() => expect(titles(view.container)).toHaveLength(3));
    const real = await vi.importActual<typeof import('../src/lib/db')>('../src/lib/db');
    // The first re-list reads now but answers late; the second answers at once.
    let release: () => void = () => {};
    const stale = real.listScans();
    list.impl = () => {
      list.impl = null;
      return new Promise((r) => {
        release = () => r(stale);
      });
    };
    notifyLibraryChanged();
    await tick(250); // re-list 1 is waiting on the slow read
    await deleteScans(['2']); // its ping starts re-list 2, which sees the delete
    await waitFor(() => expect(titles(view.container)).toEqual(['Cal', 'Stripe']));
    release();
    await tick(50);
    expect(titles(view.container)).toEqual(['Cal', 'Stripe']);
  });

  it('T4.14 a re-list that fails keeps the cards; a first load that fails says so until one works', async () => {
    await seed();
    const view = render(<Library />);
    await waitFor(() => expect(titles(view.container)).toHaveLength(3));
    list.impl = () => Promise.reject(new DOMException('closed', 'DatabaseClosedError'));
    notifyLibraryChanged();
    await tick(250);
    expect(titles(view.container)).toHaveLength(3);
    expect(within(view.container).queryByRole('alert')).toBeNull();
    view.unmount();

    const again = render(<Library />);
    await waitFor(() =>
      expect(within(again.container).getByRole('alert').textContent).toMatch(/unavailable/),
    );
    list.impl = null;
    notifyLibraryChanged();
    await waitFor(() => expect(titles(again.container)).toHaveLength(3));
    expect(within(again.container).queryByRole('alert')).toBeNull();
  });
});

describe('Compose while another window deletes (component, SPC-43)', () => {
  async function openCompose() {
    await saveScan(scanOf('1', { title: 'Stripe' }), null);
    await saveScan(scanOf('2', { title: 'Linear' }), null);
    await saveScan(scanOf('3', { title: 'Cal' }), null);
    await tick();
    const view = render(<Library />);
    await waitFor(() =>
      expect(within(view.container).getAllByTestId('library-card')).toHaveLength(3),
    );
    fireEvent.click(within(view.container).getByRole('button', { name: 'Compose' }));
    const select = (f: string) =>
      view.container.querySelector(`#compose-${f}`) as HTMLSelectElement;
    return { view, select };
  }

  it('T4.14 a picked scan deleted elsewhere falls back to the base, says so, and is not saved as a source', async () => {
    const { view, select } = await openCompose();
    const base = select('base').value;
    const other = ['1', '2', '3'].find((id) => id !== base) as string;
    fireEvent.change(select('colors'), { target: { value: other } });
    expect(select('colors').value).toBe(other);
    await deleteScans([other]);
    await waitFor(() =>
      expect(within(view.container).getByRole('status').textContent).toMatch(
        /deleted in another window/,
      ),
    );
    expect(select('colors').value).toBe(base);
    fireEvent.click(within(view.container).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await db.composes.count()).toBe(1));
    const [row] = await db.composes.toArray();
    expect(Object.values(row?.sources ?? {})).not.toContain(other);
  });

  it('T4.14 a base deleted elsewhere moves to a scan that is left; the preview and Save stay', async () => {
    const { view, select } = await openCompose();
    const base = select('base').value;
    await deleteScans([base]);
    await waitFor(() =>
      expect(within(view.container).getByRole('status').textContent).toMatch(
        /deleted in another window/,
      ),
    );
    const now = select('base').value;
    expect(now).not.toBe(base);
    expect(['1', '2', '3']).toContain(now);
    expect(
      (within(view.container).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
