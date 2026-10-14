/**
 * Service-worker side of the council (SPC-24). With the side panel closed nothing else can stop a
 * run, so the SW (woken by `storage.onChanged`) halts it when the Labs flag goes off, the chosen
 * provider changes or a key changes, and it keeps the toolbar badge in step with the run.
 */
import { KEY_AI, SECRET_PREFIX, SESSION_KEY } from './aiSettings';
import { clearRuns, interruptAllRunning } from './councilDb';
import { type CouncilRuntimeMsg, type RunStatus, SEEN_KEY } from './councilProtocol';
import { flagKey, loadFlag } from './flags';

type Change = { oldValue?: unknown; newValue?: unknown };

/** What decides where page data goes. `downloaded` / `encryptKeys` changes don't matter. */
function fingerprint(v: unknown): string {
  const s = (v ?? {}) as {
    provider?: string;
    webllmModel?: string;
    byok?: { preset?: string; baseUrl?: string; model?: string };
  };
  return JSON.stringify([
    s.provider ?? null,
    s.webllmModel ?? null,
    s.byok?.preset ?? null,
    s.byok?.baseUrl ?? null,
    s.byok?.model ?? null,
  ]);
}

/** Should this storage change stop a live council run? */
export function shouldHalt(changes: Record<string, Change>, area: string): boolean {
  if (area === 'session') {
    // Locking the keys (the vault key removed) stops the run; unlocking doesn't.
    const v = changes[SESSION_KEY];
    return v !== undefined && v.newValue === undefined;
  }
  if (area !== 'local') return false;
  const flag = changes[flagKey('critique')];
  if (flag && flag.newValue !== true) return true;
  const ai = changes[KEY_AI];
  if (ai && fingerprint(ai.oldValue) !== fingerprint(ai.newValue)) return true;
  return Object.keys(changes).some((k) => k.startsWith(SECRET_PREFIX));
}

export interface GuardApi {
  hasOffscreen: () => Promise<boolean>;
  sendHalt: (msg: Extract<CouncilRuntimeMsg, { type: 'council.halt' }>) => Promise<unknown>;
  setBadge: (text: string, color?: string) => Promise<unknown>;
  /** `council.seen` and the Labs flag, read fresh. */
  getSeen: () => Promise<string | null>;
  flagOn: () => Promise<boolean>;
  /** Forget stored runs and `council.seen` (the flag went off: no goal text stays on disk). */
  clear: () => Promise<unknown>;
  now?: () => number;
}

export const BADGE = { done: '✓', problem: '!' } as const;

export function badgeFor(status: RunStatus): string {
  if (status === 'done') return BADGE.done;
  if (status === 'error' || status === 'interrupted') return BADGE.problem;
  // Stopped: the user did that, nothing to announce.
  return '';
}

export function createCouncilGuard(api: GuardApi) {
  const now = api.now ?? Date.now;
  const badge = (text: string, color?: string) => api.setBadge(text, color).catch(() => {});
  return {
    async onStorageChanged(changes: Record<string, Change>, area: string): Promise<void> {
      if (area === 'local' && SEEN_KEY in changes) await badge('');
      if (!shouldHalt(changes, area)) return;
      const at = now();
      const flag = area === 'local' ? changes[flagKey('critique')] : undefined;
      // No offscreen document → no run to stop (and don't create one).
      if (await api.hasOffscreen().catch(() => false))
        await api.sendHalt({ type: 'council.halt', at }).catch(() => {});
      if (flag && flag.newValue !== true) {
        await api.clear().catch(() => {});
        await badge('');
      }
    },
    async onRuntime(msg: CouncilRuntimeMsg): Promise<void> {
      if (msg.type === 'council.started') await badge('');
      else if (msg.type === 'council.finished') {
        // A run halted by the flag going off writes its final record after the clear: clear again.
        if (!(await api.flagOn().catch(() => false))) {
          await api.clear().catch(() => {});
          return;
        }
        // The open panel may have marked it seen before this message arrived.
        if ((await api.getSeen().catch(() => null)) === msg.runId) return;
        const text = badgeFor(msg.status);
        await badge(text, text === BADGE.done ? '#16a34a' : '#dc2626');
      }
    },
    /** Browser start / extension install or update: no run survived. */
    async onStartup(): Promise<void> {
      const n = await interruptAllRunning(now()).catch(() => 0);
      if (n > 0) await badge(BADGE.problem, '#dc2626');
    },
  };
}

/** The real chrome-backed guard, for `background.ts`. */
export function chromeCouncilGuard() {
  return createCouncilGuard({
    hasOffscreen: async () =>
      (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0,
    sendHalt: (msg) => chrome.runtime.sendMessage(msg),
    setBadge: async (text, color) => {
      await chrome.action.setBadgeText({ text });
      if (color) await chrome.action.setBadgeBackgroundColor({ color });
    },
    getSeen: async () => {
      const v = (await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY];
      return typeof v === 'string' ? v : null;
    },
    flagOn: () => loadFlag('critique'),
    clear: async () => {
      await clearRuns();
      await chrome.storage.local.remove(SEEN_KEY);
    },
  });
}
