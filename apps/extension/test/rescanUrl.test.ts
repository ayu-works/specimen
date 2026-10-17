import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
const saveScan = vi.fn();
vi.mock('../src/lib/messaging', () => ({ send: (...a: unknown[]) => send(...a) }));
vi.mock('../src/lib/db', () => ({
  saveScan: (...a: unknown[]) => saveScan(...a),
  libraryErrorText: () => 'save failed',
}));
vi.mock('@specimen/core', () => ({ extract: () => ({ fake: 'scan' }) }));

const { rescanUrl } = await import('../src/lib/scanFlow');

type Tab = { id?: number; status?: string; url?: string; pendingUrl?: string; favIconUrl?: string };
type Updated = (tabId: number, info: { status?: string }, tab?: Tab) => void;
type Removed = (tabId: number) => void;

const ID = 7;
const PAGE = 'https://example.test/';
const loading: Tab = { id: ID, status: 'loading', url: PAGE };
const pending: Tab = { id: ID, status: 'loading', pendingUrl: PAGE };
const complete: Tab = { id: ID, status: 'complete', url: PAGE, favIconUrl: `${PAGE}favicon.ico` };

/** A local `chrome.tabs` stub: `create` opens tab ID, `get` answers `state()`. */
function stubTabs(state: () => Tab | Error, opts: { createId?: number | null } = {}) {
  const updated = new Set<Updated>();
  const removed = new Set<Removed>();
  const remove = vi.fn(async (_id: number) => {});
  vi.stubGlobal('chrome', {
    permissions: { contains: vi.fn(async () => true) },
    tabs: {
      create: vi.fn(async () => (opts.createId === null ? {} : { id: opts.createId ?? ID })),
      get: vi.fn(async () => {
        const t = state();
        if (t instanceof Error) throw t;
        return t;
      }),
      remove,
      onUpdated: {
        addListener: (l: Updated) => updated.add(l),
        removeListener: (l: Updated) => updated.delete(l),
      },
      onRemoved: {
        addListener: (l: Removed) => removed.add(l),
        removeListener: (l: Removed) => removed.delete(l),
      },
    },
  });
  return {
    remove,
    fireUpdated: (tabId: number, info: { status?: string }, tab?: Tab) => {
      for (const l of [...updated]) l(tabId, info, tab);
    },
    fireRemoved: (tabId: number) => {
      for (const l of [...removed]) l(tabId);
    },
  };
}

/** Run a re-scan to its end under fake timers and return how it settled. */
async function settle(p: Promise<unknown>, ms = 40000) {
  const out: { value?: unknown; error?: Error } = {};
  p.then(
    (v) => {
      out.value = v;
    },
    (e: Error) => {
      out.error = e;
    },
  );
  await vi.advanceTimersByTimeAsync(ms);
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  send.mockReset().mockResolvedValue({ raw: { hints: undefined }, screenshot: 'data:shot' });
  saveScan.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('rescanUrl closes the tab it opened on failure (SPC-45)', () => {
  it('T5.14 timeout before the navigation commits: rejects, closes our tab once, never scans', async () => {
    const t = stubTabs(() => pending);
    const r = await settle(rescanUrl(PAGE));
    expect(r.error?.message).toBe('The page took too long to load');
    expect(t.remove).toHaveBeenCalledTimes(1);
    expect(t.remove).toHaveBeenCalledWith(ID);
    expect(send).not.toHaveBeenCalled();
  });

  it('T5.14 a committed page still loading at the limit is scanned as it is; the tab stays', async () => {
    const t = stubTabs(() => loading);
    const r = await settle(rescanUrl(PAGE));
    expect(r.error).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toMatchObject({ tabId: ID });
    expect(t.remove).not.toHaveBeenCalled();
  });

  it('T5.14 the tab is closed while loading: the original error wins over "No tab with id"', async () => {
    const t = stubTabs(() => pending);
    t.remove.mockRejectedValue(new Error(`No tab with id: ${ID}.`));
    const p = rescanUrl(PAGE);
    await vi.advanceTimersByTimeAsync(100);
    t.fireRemoved(ID);
    const r = await settle(p);
    expect(r.error?.message).toBe('The tab was closed');
    expect(t.remove).toHaveBeenCalledTimes(1);
  });

  it('T5.14 a scan error closes our tab once and is passed on', async () => {
    const t = stubTabs(() => complete);
    send.mockRejectedValue(new Error('sampler returned no result'));
    const r = await settle(rescanUrl(PAGE));
    expect(r.error?.message).toBe('sampler returned no result');
    expect(t.remove).toHaveBeenCalledTimes(1);
    expect(t.remove).toHaveBeenCalledWith(ID);
  });

  it('T5.14 cleanup that throws or rejects never replaces the original error', async () => {
    const a = stubTabs(() => complete);
    send.mockRejectedValue(new Error('scan broke'));
    a.remove.mockImplementation(() => {
      throw new Error('sync remove failure');
    });
    expect((await settle(rescanUrl(PAGE))).error?.message).toBe('scan broke');

    const b = stubTabs(() => complete);
    b.remove.mockRejectedValue(new Error('Tabs cannot be edited right now'));
    expect((await settle(rescanUrl(PAGE))).error?.message).toBe('scan broke');
    expect(b.remove).toHaveBeenCalledTimes(1);
  });

  it('T5.14 success: returns the scan and favicon, and leaves the tab open', async () => {
    const t = stubTabs(() => complete);
    const r = await settle(rescanUrl(PAGE));
    expect(r.value).toMatchObject({
      scan: { fake: 'scan' },
      screenshot: 'data:shot',
      saveError: null,
      favicon: `${PAGE}favicon.ico`,
    });
    expect(t.remove).not.toHaveBeenCalled();
  });

  it('T5.14 a failed Library save is still a successful re-scan: the tab stays', async () => {
    const t = stubTabs(() => complete);
    saveScan.mockRejectedValue(new Error('quota'));
    const r = await settle(rescanUrl(PAGE));
    expect(r.value).toMatchObject({ saveError: 'save failed' });
    expect(t.remove).not.toHaveBeenCalled();
  });

  it('T5.14 no tab id from create: rejects, nothing is closed', async () => {
    const t = stubTabs(() => complete, { createId: null });
    const r = await settle(rescanUrl(PAGE));
    expect(r.error?.message).toBe('Could not open a tab');
    expect(t.remove).not.toHaveBeenCalled();
  });

  it('T5.14 only the tab create returned is closed, whatever other tabs do', async () => {
    const t = stubTabs(() => pending);
    const p = rescanUrl(PAGE);
    await vi.advanceTimersByTimeAsync(100);
    t.fireUpdated(9, { status: 'complete' }, { id: 9, status: 'complete', url: PAGE });
    t.fireRemoved(9);
    const r = await settle(p);
    expect(r.error?.message).toBe('The page took too long to load');
    expect(t.remove.mock.calls).toEqual([[ID]]);
  });
});
