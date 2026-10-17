// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IMAGE_REJECTED_TEXT, ProviderError } from '@specimen/ai';
import { BOUNDS } from '@specimen/core/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import {
  VIBE_GAP_MS,
  VIBE_TIMEOUT_MS,
  VIBE_TIMEOUT_TEXT,
  VibeCard,
} from '../src/entrypoints/sidepanel/views/Inspect/Vibe';
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
  useStore.setState({ scan: sampleScan, screenshot: null, status: 'done', activeTab: 'inspect' });
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

/** A provider whose first call never settles (and ignores its abort signal); later calls reply `next`. */
function hangingProvider(next = REPLY) {
  const signals: (AbortSignal | undefined)[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const provider = {
    ...fakeProvider([next]),
    async *chat(_req: unknown, signal?: AbortSignal) {
      signals.push(signal);
      if (signals.length === 1) {
        await gate; // never opened unless a test sends a late reply
        yield '{"summary":"Late and loud.","keywords":["late"]}';
        return;
      }
      yield next;
    },
  };
  return { provider, signals, lateReply: () => release() };
}

const idleButton = () =>
  waitFor(() =>
    expect(screen.getByRole('button', { name: /Describe the vibe/ }).hasAttribute('disabled')).toBe(
      false,
    ),
  );

describe('Vibe card: a model call that never settles times out (SPC-40)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('T3.38 a never-settling vibe returns the card to idle with an error after the timeout', async () => {
    const h = hangingProvider();
    renderCard([], h.provider);
    await describeVibe();
    const busy = await screen.findByRole('button', { name: /Looking/ });
    expect(busy.hasAttribute('disabled')).toBe(true);
    // A wide margin: shouldAdvanceTime also moves the fake clock with real time.
    await vi.advanceTimersByTimeAsync(VIBE_TIMEOUT_MS / 2);
    expect(screen.getByRole('button', { name: /Looking/ })).toBeTruthy();
    await vi.advanceTimersByTimeAsync(VIBE_TIMEOUT_MS / 2);
    await idleButton();
    expect(await screen.findByText(VIBE_TIMEOUT_TEXT)).toBeTruthy();
    // The line is on screen, so no toast repeats it.
    expect(toastSpy).not.toHaveBeenCalled();
    expect(useStore.getState().scan?.vibe).toBeUndefined();
    // The call was told to stop.
    expect(h.signals[0]?.aborted).toBe(true);
  });

  it('T3.38 a provider that honours the abort still shows the timeout, not "Stopped"', async () => {
    const provider = {
      ...fakeProvider([]),
      async *chat(_req: unknown, signal?: AbortSignal) {
        await new Promise((_, reject) =>
          signal?.addEventListener('abort', () => reject(new ProviderError('aborted', 'Stopped'))),
        );
        yield '';
      },
    };
    renderCard([], provider);
    await describeVibe();
    await vi.advanceTimersByTimeAsync(VIBE_TIMEOUT_MS);
    await idleButton();
    expect(await screen.findByText(VIBE_TIMEOUT_TEXT)).toBeTruthy();
    expect(screen.queryByText('Stopped')).toBeNull();
  });

  it('T3.38 a late reply after the timeout is dropped; a new run after it is shown and saved', async () => {
    await saveScan(sampleScan, null);
    const saved: unknown[] = [];
    save.impl = async (...a) => {
      saved.push(a[1]);
    };
    const h = hangingProvider('{"summary":"Second and calm.","keywords":["calm"]}');
    renderCard([], h.provider);
    await describeVibe();
    await vi.advanceTimersByTimeAsync(VIBE_TIMEOUT_MS);
    await idleButton();
    // A second run while the first provider call is still stuck.
    await describeVibe();
    expect(await screen.findByText('Second and calm.')).toBeTruthy();
    await waitFor(() => expect(saved).toHaveLength(1));
    // Now the first call replies, late.
    h.lateReply();
    await vi.advanceTimersByTimeAsync(VIBE_TIMEOUT_MS);
    expect(screen.queryByText('Late and loud.')).toBeNull();
    expect(useStore.getState().scan?.vibe?.summary).toBe('Second and calm.');
    expect(saved).toEqual([{ vibe: expect.objectContaining({ summary: 'Second and calm.' }) }]);
    expect(screen.queryByText(VIBE_TIMEOUT_TEXT)).toBeNull();
  });

  it('T3.38 slow but steady text is not cut off (the timer restarts on each piece)', async () => {
    const pieces = ['{"summary":"Slow ', 'and ', 'steady', '.","keywords":', '["slow"]', '}'];
    const provider = {
      ...fakeProvider([]),
      async *chat() {
        for (const p of pieces) {
          await new Promise((r) => setTimeout(r, VIBE_GAP_MS - 5000));
          yield p;
        }
      },
    };
    renderCard([], provider);
    await describeVibe();
    // Well past the first-text timeout in total, but never a gap that long.
    for (let i = 0; i < pieces.length; i++) await vi.advanceTimersByTimeAsync(VIBE_GAP_MS - 5000);
    expect(await screen.findByText('Slow and steady.')).toBeTruthy();
    expect(screen.queryByText(VIBE_TIMEOUT_TEXT)).toBeNull();
  });

  it('T3.38 text that stops mid-reply times out after the gap', async () => {
    const provider = {
      ...fakeProvider([]),
      async *chat() {
        yield '{"summary":"Half';
        await new Promise(() => {});
      },
    };
    renderCard([], provider);
    await describeVibe();
    await vi.advanceTimersByTimeAsync(VIBE_GAP_MS);
    await idleButton();
    expect(await screen.findByText(VIBE_TIMEOUT_TEXT)).toBeTruthy();
  });

  it('T3.38 a second call inside vibe() gets the full first-text timeout, not the gap', async () => {
    // Call 1 streams, then fails (the image is rejected); call 2 thinks for 40 s before its text.
    let calls = 0;
    const provider = {
      ...fakeProvider([]),
      capabilities: { vision: true, streaming: true, contextTokens: 8000 },
      async *chat() {
        calls++;
        if (calls === 1) {
          yield '{"summary":"Half';
          throw new ProviderError('other', IMAGE_REJECTED_TEXT);
        }
        await new Promise((r) => setTimeout(r, 40_000));
        yield REPLY;
      },
    };
    useStore.setState({ screenshot: 'data:image/png;base64,AAAA' });
    renderCard([], provider);
    await describeVibe();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await screen.findByText('Calm and airy.')).toBeTruthy();
    expect(calls).toBe(2);
    expect(screen.queryByText(VIBE_TIMEOUT_TEXT)).toBeNull();
  });

  it('T3.38 a card remounted during the hang is busy, then idle with the error at the timeout', async () => {
    const h = hangingProvider();
    const first = renderCard([], h.provider);
    await describeVibe();
    first.unmount();
    render(card());
    const button = await screen.findByRole('button', { name: /Looking/ });
    expect(button.hasAttribute('disabled')).toBe(true);
    await vi.advanceTimersByTimeAsync(VIBE_TIMEOUT_MS);
    await idleButton();
    // The remounted card is on screen, so it shows the line and no toast repeats it.
    expect(await screen.findByText(VIBE_TIMEOUT_TEXT)).toBeTruthy();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('T3.38 a timeout while Inspect is closed is toasted and shown when the card comes back', async () => {
    const h = hangingProvider();
    const first = renderCard([], h.provider);
    await describeVibe();
    first.unmount(); // a tab switch
    await vi.advanceTimersByTimeAsync(VIBE_TIMEOUT_MS);
    expect(toastSpy).toHaveBeenCalledWith(VIBE_TIMEOUT_TEXT);
    render(card());
    await idleButton();
    expect(await screen.findByText(VIBE_TIMEOUT_TEXT)).toBeTruthy();
    // Not on another scan.
    useStore.setState({ scan: { ...sampleScan, id: 'other', vibe: undefined } });
    await waitFor(() => expect(screen.queryByText(VIBE_TIMEOUT_TEXT)).toBeNull());
  });

  it('T3.38 a reply in time is shown, and the timeout later adds no error', async () => {
    renderCard();
    await describeVibe();
    expect(await screen.findByText('Calm and airy.')).toBeTruthy();
    await idleButton();
    await vi.advanceTimersByTimeAsync(VIBE_TIMEOUT_MS * 2);
    expect(screen.queryByText(VIBE_TIMEOUT_TEXT)).toBeNull();
    expect(toastSpy).not.toHaveBeenCalled();
    expect(useStore.getState().scan?.vibe?.summary).toBe('Calm and airy.');
  });
});
