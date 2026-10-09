import { vi } from 'vitest';

type Listener = (changes: Record<string, unknown>, area: string) => void;

function area(name: string, listeners: Set<Listener>) {
  const data = new Map<string, unknown>();
  const pick = (keys?: string | string[] | null) => {
    if (keys === null || keys === undefined) return Object.fromEntries(data);
    const list = typeof keys === 'string' ? [keys] : keys;
    return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]));
  };
  return {
    data,
    get: vi.fn(async (keys?: string | string[] | null) => pick(keys)),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(items)) {
        data.set(k, v);
        changes[k] = { newValue: v };
      }
      for (const l of listeners) l(changes, name);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const changes: Record<string, unknown> = {};
      for (const k of typeof keys === 'string' ? [keys] : keys) {
        data.delete(k);
        changes[k] = {};
      }
      for (const l of listeners) l(changes, name);
    }),
  };
}

/**
 * A small in-memory `chrome` for component tests: storage (local/session/sync with a shared
 * `onChanged`), permissions (everything granted), tabs, and a few runtime calls.
 */
export function makeChrome() {
  const listeners = new Set<Listener>();
  const noEvent = { addListener: vi.fn(), removeListener: vi.fn() };
  return {
    storage: {
      local: area('local', listeners),
      session: area('session', listeners),
      sync: area('sync', listeners),
      onChanged: {
        addListener: (l: Listener) => listeners.add(l),
        removeListener: (l: Listener) => listeners.delete(l),
      },
    },
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    runtime: {
      openOptionsPage: vi.fn(),
      sendMessage: vi.fn(async () => undefined),
      getContexts: vi.fn(async () => []),
    },
    tabs: {
      query: vi.fn(async () => []),
      onActivated: noEvent,
      onUpdated: noEvent,
      onRemoved: noEvent,
    },
  };
}

export type FakeChrome = ReturnType<typeof makeChrome>;

/** Install a fresh fake `chrome` as the global and return it. */
export function installChrome(): FakeChrome {
  const c = makeChrome();
  vi.stubGlobal('chrome', c);
  return c;
}

/** A tiny fake `LLMProvider` that streams `chunks`. */
export function fakeProvider(chunks: string[] = ['The accent ', 'is #5e6ad2.']) {
  return {
    id: 'fake',
    label: 'Fake AI',
    capabilities: { vision: false, streaming: true, contextTokens: 8000 },
    status: async () => ({ state: 'ready' as const }),
    async *chat() {
      for (const c of chunks) {
        await Promise.resolve();
        yield c;
      }
    },
  };
}
