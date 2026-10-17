// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { BOUNDS } from '@specimen/core/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { VibeCard } from '../src/entrypoints/sidepanel/views/Inspect/Vibe';
import { AiProvider } from '../src/lib/aiContext';
import { db, getStoredScan, saveScan } from '../src/lib/db';
import { fakeProvider, installChrome } from './helpers/chrome';

// The real updateScan unless a test swaps in a failing or pending one.
const save = vi.hoisted(() => ({ impl: null as null | ((...a: unknown[]) => Promise<void>) }));
vi.mock('../src/lib/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/db')>();
  return {
    ...real,
    updateScan: (...a: Parameters<typeof real.updateScan>) =>
      save.impl ? save.impl(...a) : real.updateScan(...a),
  };
});

const toastSpy = vi.hoisted(() => vi.fn<(m: string) => void>());
vi.mock('../src/components/toast', () => ({ toast: toastSpy, Toaster: () => null }));

/** A provider whose reply waits for `open()`: the model call stays in flight until then. */
function gatedProvider(text: string) {
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const provider = {
    ...fakeProvider([text]),
    async *chat() {
      await gate;
      yield text;
    },
  };
  return { provider, open: () => open() };
}

const REPLY = '{"summary":"Calm and airy.","keywords":["calm","airy"]}';
const quota = () =>
  Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));

beforeEach(async () => {
  installChrome();
  toastSpy.mockReset();
  await db.scans.clear();
  useStore.setState({ scan: sampleScan, status: 'done', activeTab: 'inspect' });
});

afterEach(() => {
  cleanup();
  save.impl = null;
  delete (globalThis as { __specimenProvider?: unknown }).__specimenProvider;
});

const card = () => (
  <AiProvider>
    <VibeCard />
  </AiProvider>
);

function renderCard(chunks: string[] = [REPLY], provider: unknown = fakeProvider(chunks)) {
  (globalThis as { __specimenProvider?: unknown }).__specimenProvider = provider;
  return render(
    <AiProvider>
      <VibeCard />
    </AiProvider>,
  );
}

async function describeVibe() {
  const button = await screen.findByRole('button', { name: /Describe the vibe/ });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
}

describe('Vibe card: a vibe that cannot be saved says so (SPC-33)', () => {
  it('T3.36 a failed Library write keeps the vibe shown and says it was not saved', async () => {
    save.impl = quota;
    renderCard();
    await describeVibe();
    expect(await screen.findByText('Calm and airy.')).toBeTruthy();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Vibe not saved to Library: your browser is out of storage space',
    );
    // The vibe itself worked: the store keeps it for the prompt.
    expect(useStore.getState().scan?.vibe?.summary).toBe('Calm and airy.');
    // And as a toast, which outlives the card.
    expect(toastSpy).toHaveBeenCalledWith(
      'Vibe not saved to Library: your browser is out of storage space',
    );
  });

  it('T3.36 a successful save (or a scan not in the Library) shows no error', async () => {
    renderCard();
    await describeVibe();
    expect(await screen.findByText('Calm and airy.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Describe the vibe/ })).toBeTruthy(),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('T3.36 a save failing after the panel moved to another scan shows nothing there', async () => {
    let fail: (e: unknown) => void = () => {};
    save.impl = () =>
      new Promise((_, reject) => {
        fail = reject;
      });
    renderCard();
    await describeVibe();
    expect(await screen.findByText('Calm and airy.')).toBeTruthy();
    useStore.setState({ scan: { ...sampleScan, id: 'other', vibe: undefined } });
    fail(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Describe the vibe/ }).hasAttribute('disabled'),
      ).toBe(false),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    // The failure is still reported, by toast, for the scan it belongs to.
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it('T3.36 a save failing after Inspect unmounted (a tab switch) is still reported', async () => {
    let fail: (e: unknown) => void = () => {};
    save.impl = () =>
      new Promise((_, reject) => {
        fail = reject;
      });
    const { unmount } = renderCard();
    await describeVibe();
    expect(await screen.findByText('Calm and airy.')).toBeTruthy();
    unmount();
    fail(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        'Vibe not saved to Library: your browser is out of storage space',
      ),
    );
  });

  it('T3.36 a card remounted during the model call is busy and cannot start a second run', async () => {
    const g = gatedProvider(REPLY);
    const first = renderCard([], g.provider);
    await describeVibe();
    first.unmount();
    render(card());
    const button = await screen.findByRole('button', { name: /Looking/ });
    expect(button.hasAttribute('disabled')).toBe(true);
    g.open();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Describe the vibe/ }).hasAttribute('disabled'),
      ).toBe(false),
    );
    expect(useStore.getState().scan?.vibe?.summary).toBe('Calm and airy.');
  });

  it('T3.36 a vibe finished after the panel moved to another scan is saved to its own scan, not shown', async () => {
    await saveScan(sampleScan, null);
    const g = gatedProvider(REPLY);
    renderCard([], g.provider);
    await describeVibe();
    const other = { ...sampleScan, id: 'other', vibe: undefined };
    useStore.setState({ scan: other });
    g.open();
    await waitFor(async () =>
      expect((await getStoredScan(sampleScan.id))?.vibe?.summary).toBe('Calm and airy.'),
    );
    expect(useStore.getState().scan?.vibe).toBeUndefined();
    expect(screen.queryByText('Calm and airy.')).toBeNull();
  });

  it('T3.36 a save that never settles does not keep the button busy', async () => {
    let settle: () => void = () => {};
    save.impl = () =>
      new Promise<void>((r) => {
        settle = r;
      });
    renderCard();
    await describeVibe();
    expect(await screen.findByText('Calm and airy.')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Describe the vibe/ }).hasAttribute('disabled'),
      ).toBe(false),
    );
    settle(); // let the module's save queue drain for the next test
  });

  it('T3.36 a looping model’s vibe saves to the Library within the v5 bounds (real updateScan)', async () => {
    await saveScan(sampleScan, null);
    const summary = 'calm airy spacious '.repeat(3000);
    const keywords = Array.from({ length: 200 }, (_, i) => `k${i} ${'wide '.repeat(100)}`);
    renderCard([JSON.stringify({ summary, keywords })]);
    await describeVibe();
    await waitFor(async () => expect((await getStoredScan(sampleScan.id))?.vibe).toBeTruthy());
    const stored = (await getStoredScan(sampleScan.id))?.vibe;
    expect(stored?.summary.length).toBeLessThanOrEqual(BOUNDS.vibeSummary);
    expect(stored?.keywords.length).toBeGreaterThan(0);
    for (const k of stored?.keywords ?? []) expect(k.length).toBeLessThanOrEqual(BOUNDS.keyword);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
