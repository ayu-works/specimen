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

/** Chrome's message when a permission not in the manifest is requested. */
export const NOT_IN_MANIFEST = 'Only permissions specified in the manifest may be requested.';

export interface PermissionOpts {
  /** What is already held. `'all'` (the default) grants everything, as before. */
  held?: 'all' | { origins?: string[]; permissions?: string[] };
  /** The user's answer to a prompt for something not held. Default `'grant'`. */
  answer?: 'grant' | 'deny' | 'throw';
  /** The rejection message for `answer: 'throw'` (default: {@link NOT_IN_MANIFEST}). */
  error?: string;
}

interface PermissionQuery {
  origins?: string[];
  permissions?: string[];
}

/**
 * Permissions that can say no. Deny is opt-in: with no options everything is held. Origins match
 * exactly (or via a held `<all_urls>`); real Chrome also matches patterns (`https://*.x.com/*`
 * covers `https://a.x.com/*`), which this stub does not. `remove` only affects the opt-in mode.
 */
function permissionsArea(opts: PermissionOpts = {}) {
  const all = (opts.held ?? 'all') === 'all';
  const fromOpts = opts.held && opts.held !== 'all' ? opts.held : {};
  const held = {
    origins: new Set(fromOpts.origins ?? []),
    permissions: new Set(fromOpts.permissions ?? []),
  };
  const has = (q: PermissionQuery) =>
    all ||
    ((q.origins ?? []).every((o) => held.origins.has(o) || held.origins.has('<all_urls>')) &&
      (q.permissions ?? []).every((p) => held.permissions.has(p)));
  return {
    /** What was granted. In `'all'` mode it stays empty and `remove` is a no-op; pass `held: {}` to track grants. */
    held,
    contains: vi.fn(async (q: PermissionQuery = {}) => has(q)),
    request: vi.fn(async (q: PermissionQuery = {}) => {
      if (has(q)) return true;
      const answer = opts.answer ?? 'grant';
      if (answer === 'throw') throw new Error(opts.error ?? NOT_IN_MANIFEST);
      if (answer === 'deny') return false;
      for (const o of q.origins ?? []) held.origins.add(o);
      for (const p of q.permissions ?? []) held.permissions.add(p);
      return true;
    }),
    remove: vi.fn(async (q: PermissionQuery = {}) => {
      for (const o of q.origins ?? []) held.origins.delete(o);
      for (const p of q.permissions ?? []) held.permissions.delete(p);
      return true;
    }),
  };
}

/**
 * A small in-memory `chrome` for component tests: storage (local/session/sync with a shared
 * `onChanged`), permissions (everything granted unless `opts.permissions` says otherwise), tabs,
 * and a few runtime calls.
 */
export function makeChrome(opts: { permissions?: PermissionOpts } = {}) {
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
    permissions: permissionsArea(opts.permissions),
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
export function installChrome(opts: { permissions?: PermissionOpts } = {}): FakeChrome {
  const c = makeChrome(opts);
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
