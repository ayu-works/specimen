import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { friendlyScanError, waitForTabLoad } from '../src/lib/scanFlow';

type Tab = { id?: number; status?: string; url?: string; pendingUrl?: string };
type Updated = (tabId: number, info: { status?: string }, tab?: Tab) => void;
type Removed = (tabId: number) => void;

const ID = 5;
const PAGE = 'https://example.test/';

/** A local `chrome.tabs` stub: `get` answers from a queue (the last answer repeats). */
function stubTabs(answers: Array<Tab | Error>, opts: { onAdd?: (fire: Updated) => void } = {}) {
  const updated = new Set<Updated>();
  const removed = new Set<Removed>();
  const queue = [...answers];
  const get = vi.fn(async (_id: number) => {
    const next = (queue.length > 1 ? queue.shift() : queue[0]) as Tab | Error;
    if (next instanceof Error) throw next;
    return next;
  });
  const fireUpdated: Updated = (tabId, info, tab) => {
    for (const l of [...updated]) l(tabId, info, tab);
  };
  vi.stubGlobal('chrome', {
    tabs: {
      get,
      onUpdated: {
        addListener: (l: Updated) => {
          updated.add(l);
          opts.onAdd?.(fireUpdated);
        },
        removeListener: (l: Updated) => updated.delete(l),
      },
      onRemoved: {
        addListener: (l: Removed) => removed.add(l),
        removeListener: (l: Removed) => removed.delete(l),
      },
    },
  });
  return {
    get,
    fireUpdated,
    fireRemoved: (tabId: number) => {
      for (const l of [...removed]) l(tabId);
    },
    listeners: () => updated.size + removed.size,
  };
}

/** Track a promise's outcome without awaiting it. */
function track(p: Promise<void>) {
  const s: { state: 'pending' | 'resolved' | 'rejected'; error?: Error } = { state: 'pending' };
  p.then(
    () => {
      s.state = 'resolved';
    },
    (e: Error) => {
      s.state = 'rejected';
      s.error = e;
    },
  );
  return s;
}

const loading: Tab = { id: ID, status: 'loading', url: PAGE };
const complete: Tab = { id: ID, status: 'complete', url: PAGE };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('waitForTabLoad (SPC-28)', () => {
  it('T5.12 complete before the listener attaches: the first read resolves it', async () => {
    const t = stubTabs([complete]);
    const s = track(waitForTabLoad(ID));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe('resolved');
    expect(t.listeners()).toBe(0);
  });

  it('T5.12 complete while the listener attaches (the read is stale): resolves once', async () => {
    const t = stubTabs([loading], {
      // Chrome dispatches events asynchronously: this lands before the read answers.
      onAdd: (fire) => queueMicrotask(() => fire(ID, { status: 'complete' }, complete)),
    });
    const s = track(waitForTabLoad(ID));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe('resolved');
    expect(t.listeners()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.get).toHaveBeenCalledTimes(1);
  });

  it('T5.12 complete event lost (SPC-25): a later re-read resolves it', async () => {
    // The event never reaches the listener; the first read is still loading.
    const t = stubTabs([loading, complete]);
    const s = track(waitForTabLoad(ID, 30000, 500));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(500);
    expect(s.state).toBe('resolved');
    expect(t.get).toHaveBeenCalledTimes(2);
    expect(t.listeners()).toBe(0);
  });

  it('T5.12 complete after the listener attaches: the event resolves it', async () => {
    const t = stubTabs([loading]);
    const s = track(waitForTabLoad(ID));
    await vi.advanceTimersByTimeAsync(100);
    expect(s.state).toBe('pending');
    t.fireUpdated(ID, { status: 'complete' }, complete);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe('resolved');
    expect(t.listeners()).toBe(0);
  });

  it("T5.12 another tab's complete, or this tab's other updates, are ignored", async () => {
    const t = stubTabs([loading]);
    const s = track(waitForTabLoad(ID));
    t.fireUpdated(9, { status: 'complete' }, { ...complete, id: 9 });
    t.fireUpdated(ID, { status: 'loading' }, loading);
    t.fireUpdated(ID, {}, complete);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.state).toBe('pending');
    t.fireUpdated(ID, { status: 'complete' });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe('resolved');
  });

  it('T5.12 the initial about:blank (or a pending navigation) is not the loaded page', async () => {
    const blank: Tab = { id: ID, status: 'complete', url: 'about:blank', pendingUrl: PAGE };
    const t = stubTabs([blank, { ...complete, pendingUrl: PAGE }, complete]);
    const s = track(waitForTabLoad(ID, 30000, 500));
    t.fireUpdated(ID, { status: 'complete' }, { id: ID, status: 'complete', url: 'about:blank' });
    await vi.advanceTimersByTimeAsync(500);
    expect(s.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(500);
    expect(s.state).toBe('resolved');
    expect(t.get).toHaveBeenCalledTimes(3);
  });

  it('T5.12 a url Chrome hides (no host access) still counts as loaded', async () => {
    stubTabs([{ id: ID, status: 'complete' }]);
    const s = track(waitForTabLoad(ID));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe('resolved');
  });

  it('T5.12 timeout: rejects with a clear error, then reads and listens no more', async () => {
    const t = stubTabs([loading]);
    const s = track(waitForTabLoad(ID, 3000, 500));
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.state).toBe('rejected');
    expect(s.error?.message).toBe('The page took too long to load');
    expect(t.listeners()).toBe(0);
    const calls = t.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(t.get).toHaveBeenCalledTimes(calls);
    expect(friendlyScanError(s.error?.message ?? '')).toBe(
      'The page took too long to load. Check the address or your connection and try again.',
    );
  });

  it('T5.12 a slow read is never overlapped by the next one', async () => {
    let answer: ((t: Tab) => void) | undefined;
    const t = stubTabs([loading]);
    t.get.mockImplementationOnce(() => new Promise<Tab>((r) => (answer = r)));
    const s = track(waitForTabLoad(ID, 30000, 500));
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.get).toHaveBeenCalledTimes(1);
    answer?.(loading);
    await vi.advanceTimersByTimeAsync(500);
    expect(t.get).toHaveBeenCalledTimes(2);
    expect(s.state).toBe('pending');
  });

  it('T5.12 the tab is closed: rejects at once, from the event or from the read', async () => {
    const a = stubTabs([loading]);
    const s1 = track(waitForTabLoad(ID));
    a.fireRemoved(9);
    a.fireRemoved(ID);
    await vi.advanceTimersByTimeAsync(0);
    expect(s1.state).toBe('rejected');
    expect(s1.error?.message).toBe('The tab was closed');
    expect(a.listeners()).toBe(0);

    stubTabs([new Error(`No tab with id: ${ID}.`)]);
    const s2 = track(waitForTabLoad(ID));
    await vi.advanceTimersByTimeAsync(0);
    expect(s2.state).toBe('rejected');
    expect(friendlyScanError(s2.error?.message ?? '')).toBe(
      'The tab was closed before the scan finished.',
    );
  });

  it('T5.12 a passing read failure is retried, then the load resolves', async () => {
    const t = stubTabs([new Error('Tabs cannot be edited right now'), complete]);
    const s = track(waitForTabLoad(ID, 30000, 500));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(500);
    expect(s.state).toBe('resolved');
    expect(t.get).toHaveBeenCalledTimes(2);
  });
});
