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

const REPLY = '{"summary":"Calm and airy.","keywords":["calm","airy"]}';
const quota = () =>
  Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));

beforeEach(async () => {
  installChrome();
  await db.scans.clear();
  useStore.setState({ scan: sampleScan, status: 'done', activeTab: 'inspect' });
});

afterEach(() => {
  cleanup();
  save.impl = null;
  delete (globalThis as { __specimenProvider?: unknown }).__specimenProvider;
});

function renderCard(chunks: string[] = [REPLY]) {
  (globalThis as { __specimenProvider?: unknown }).__specimenProvider = fakeProvider(chunks);
  render(
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
