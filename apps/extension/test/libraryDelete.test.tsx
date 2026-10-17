// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { Library } from '../src/entrypoints/sidepanel/views/Library';
import { db, saveScan } from '../src/lib/db';
import { installChrome } from './helpers/chrome';

// A 1×1 PNG, so each scan also gets a thumbnail row.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const seed = async (id: string, host: string, title: string) => {
  await saveScan({ ...sampleScan, id, host, title, url: `https://${host}/`, scannedAt: 1 }, PNG);
  await db.chats.put({ scanId: id, messages: [] });
};

const names = () =>
  screen.queryAllByTestId('library-card').map((c) => c.querySelector('.truncate')?.textContent);
const card = (title: string) =>
  screen.getAllByTestId('library-card').find((c) => c.textContent?.includes(title)) as HTMLElement;
const rows = async (id: string) => ({
  scan: await db.scans.get(id),
  thumb: await db.thumbs.get(id),
  chat: await db.chats.get(id),
});

async function renderLibrary() {
  render(<Library />);
  await waitFor(() => expect(screen.getAllByTestId('library-card')).toHaveLength(3));
}

let confirm: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  installChrome();
  useStore.setState({ scan: null, status: 'idle', activeTab: 'library' });
  await Promise.all([db.scans.clear(), db.thumbs.clear(), db.chats.clear()]);
  await seed('1', 'stripe.com', 'Stripe | Payments');
  await seed('2', 'linear.app', 'Linear');
  await seed('3', 'cal.com', 'Cal.com scheduling');
  confirm = vi.fn(() => true);
  vi.stubGlobal('confirm', confirm);
  // fake-indexeddb hands the thumbnail back as a plain object, which jsdom's URL rejects.
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:thumb');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Library delete (component, SPC-39)', () => {
  it('T4.12 every card shows a Delete button without opening a menu', async () => {
    await renderLibrary();
    for (const title of ['Stripe | Payments', 'Linear', 'Cal.com scheduling']) {
      const button = within(card(title)).getByRole('button', { name: `Delete ${title}` });
      expect(button.getAttribute('title')).toBe(`Delete ${title}`);
    }
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('T4.12 confirm deletes the scan, its thumbnail and its chat', async () => {
    await renderLibrary();
    expect((await rows('2')).thumb).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Linear' }));
    expect(confirm).toHaveBeenCalledWith('Delete "Linear" from your Library?');
    await waitFor(() =>
      expect(names().sort()).toEqual(['Cal.com scheduling', 'Stripe | Payments']),
    );
    expect(await rows('2')).toEqual({ scan: undefined, thumb: undefined, chat: undefined });
    expect((await rows('1')).scan).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('T4.12 the confirm shows a page title as plain text', async () => {
    const title = '<img src=x onerror=alert(1)> "Quoted"';
    await seed('4', 'evil.test', title);
    render(<Library />);
    await waitFor(() => expect(screen.getAllByTestId('library-card')).toHaveLength(4));
    confirm.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: `Delete ${title}` }));
    expect(confirm).toHaveBeenCalledWith(`Delete "${title}" from your Library?`);
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('T4.12 cancel keeps the card and every row', async () => {
    confirm.mockReturnValue(false);
    await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Linear' }));
    expect(confirm).toHaveBeenCalledOnce();
    // Give a (wrong) write the chance to land before checking nothing changed.
    await new Promise((r) => setTimeout(r, 20));
    expect(names()).toContain('Linear');
    const kept = await rows('2');
    expect(kept.scan && kept.thumb && kept.chat).toBeTruthy();
  });

  it('T4.12 a delete that fails shows the error and keeps the scan, thumbnail and chat', async () => {
    const fail = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    // The chats table is deleted last in the transaction, so scans and thumbs must roll back.
    db.chats.hook('deleting', fail);
    try {
      await renderLibrary();
      fireEvent.click(screen.getByRole('button', { name: 'Delete Linear' }));
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toMatch(
          /Could not delete that scan: your browser is out of storage space/,
        ),
      );
      expect(names()).toContain('Linear');
      const kept = await rows('2');
      expect(kept.scan?.title).toBe('Linear');
      expect(kept.thumb).toBeTruthy();
      expect(kept.chat).toBeTruthy();
    } finally {
      db.chats.hook('deleting').unsubscribe(fail);
    }
  });

  it('T4.12 the ⋯ menu Delete still works, and Escape closes the menu', async () => {
    await renderLibrary();
    const more = within(card('Linear')).getByRole('button', { name: 'More actions' });
    fireEvent.click(more);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(more);
    const item = screen.getByRole('menuitem', { name: 'Delete' });
    // A real click starts with pointerdown; it must not count as a click outside the menu.
    fireEvent.pointerDown(item);
    fireEvent.click(item);
    await waitFor(() => expect(names()).not.toContain('Linear'));
    expect((await rows('2')).scan).toBeUndefined();
  });

  it('T4.12 the other menu items still work', async () => {
    await renderLibrary();
    const open = () => {
      fireEvent.click(within(card('Linear')).getByRole('button', { name: 'More actions' }));
    };
    const pick = (name: string) => {
      const item = screen.getByRole('menuitem', { name });
      fireEvent.pointerDown(item);
      fireEvent.click(item);
    };

    open();
    pick('Favorite');
    await waitFor(async () => expect((await db.scans.get('2'))?.favorite).toBe(true));

    open();
    pick('Tags');
    const tags = screen.getByLabelText('Tags, comma separated');
    fireEvent.change(tags, { target: { value: 'dark, tool' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    await waitFor(async () => expect((await db.scans.get('2'))?.tags).toEqual(['dark', 'tool']));

    open();
    pick('Rename');
    const box = screen.getByLabelText('Title');
    fireEvent.change(box, { target: { value: 'Linear app' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(names()).toContain('Linear app'));

    open();
    pick('Check a build against this');
    await waitFor(() => expect(useStore.getState().activeTab).toBe('generate'));
  });

  it('T4.12 a deleted scan no longer counts in Export', async () => {
    await renderLibrary();
    fireEvent.click(within(card('Linear')).getByLabelText('Select for export'));
    expect(screen.getByRole('button', { name: /Export \(1\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Linear' }));
    await waitFor(() => expect(names()).not.toContain('Linear'));
    expect(screen.queryByRole('button', { name: /Export \(/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
  });
});
