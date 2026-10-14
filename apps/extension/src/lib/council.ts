/**
 * Side-panel side of the council (SPC-24). The run lives in the offscreen host; this store reads
 * the newest stored record, reattaches to a live run over Port `council`, and marks a run whose
 * host is gone `interrupted` so the mascot never thinks forever.
 */
import { DEFAULT_PERSONAS, MAX_CONTEXT, type PersonaId } from '@specimen/ai';
import type { DesignScan } from '@specimen/core/schema';
import { create } from 'zustand';
import type { MascotMood } from '@/components/Mascot';
import { resolveProviderSpec } from './aiRuntime';
import { getRun, latestRun, markInterrupted, saveIfStillRunning } from './councilDb';
import {
  COUNCIL_PORT,
  COUNCIL_V,
  type CouncilRecord,
  type HostMsg,
  type PanelMsg,
  type ProviderSpec,
  SEEN_KEY,
} from './councilProtocol';
import { loadFlag } from './flags';
import { send } from './messaging';

/** How long a live host gets to answer `attach` before the run counts as interrupted. */
export const ATTACH_TIMEOUT_MS = 3000;

interface PortLike {
  postMessage(msg: PanelMsg): void;
  onMessage: { addListener(cb: (m: HostMsg) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
  disconnect(): void;
}

/** Chrome calls, swappable in tests. */
export const councilIo = {
  connect: (): PortLike => chrome.runtime.connect({ name: COUNCIL_PORT }) as unknown as PortLike,
  hasOffscreen: async (): Promise<boolean> => {
    try {
      return (
        (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0
      );
    } catch {
      return false;
    }
  },
  ensure: async (): Promise<void> => {
    await send('offscreen.ensure', {});
  },
  attachTimeoutMs: ATTACH_TIMEOUT_MS,
  /** Re-read at start and after acceptance (the run must still be what the user chose). */
  flagOn: (): Promise<boolean> => loadFlag('critique'),
  spec: (): Promise<ProviderSpec | null> => resolveProviderSpec(),
};

interface CouncilState {
  /** The newest run (live or stored), or null. */
  record: CouncilRecord | null;
  loaded: boolean;
  /** The runId whose finished result a panel has shown (`council.seen`). */
  seen: string | null;
  /** A start the host refused, or a start that failed to reach it (fixed text). */
  rejected: string | null;
  starting: boolean;
  personas: PersonaId[];
  rounds: number;
  context: string;
  setPersonas: (p: PersonaId[]) => void;
  setRounds: (n: number) => void;
  setContext: (t: string) => void;
}

export const useCouncil = create<CouncilState>((set) => ({
  record: null,
  loaded: false,
  seen: null,
  rejected: null,
  starting: false,
  personas: DEFAULT_PERSONAS,
  rounds: 2,
  context: '',
  setPersonas: (personas) => set({ personas }),
  setRounds: (rounds) => set({ rounds }),
  setContext: (t) => set({ context: t.slice(0, MAX_CONTEXT) }),
}));

let port: PortLike | null = null;
/** The runId of a start we sent and the host hasn't accepted yet. */
let pendingStart: { runId: string } | null = null;
/** A run we believe is live, until the host's first snapshot confirms it (or not). */
let awaiting: { runId: string; timer: ReturnType<typeof setTimeout> } | null = null;

export const LOST_HOST = 'Could not reach the council host. Reload the extension and try again.';
export const SETTINGS_CHANGED = 'Your AI settings changed. Start the council again.';

/** Where the run would go, compared in memory only (it includes the key; never stored or logged). */
async function currentSpec(): Promise<string | null> {
  if (!(await councilIo.flagOn())) return null;
  const spec = await councilIo.spec().catch(() => null);
  return spec ? JSON.stringify(spec) : null;
}

function adopt(rec: CouncilRecord): void {
  const cur = useCouncil.getState().record;
  // The run we know, or a newer one (another window started it).
  if (cur && rec.runId !== cur.runId && rec.startedAt < cur.startedAt) return;
  useCouncil.setState({ record: rec });
}

function onHostMsg(msg: HostMsg): void {
  if (msg.type === 'snapshot') {
    const rec = msg.record;
    if (awaiting) {
      const a = awaiting;
      awaiting = null;
      clearTimeout(a.timer);
      // The host is alive but doesn't know the run we stored as running: it died earlier.
      if (rec?.runId !== a.runId) {
        const cur = useCouncil.getState().record;
        if (cur?.runId === a.runId && cur.status === 'running') void interrupt(cur, true);
      }
    }
    if (!rec) return;
    const pend = pendingStart;
    // Only a running run answers a start; a finished one never unblocks or blocks Start.
    if (pend && rec.status === 'running') {
      pendingStart = null;
      useCouncil.setState({ starting: false, rejected: null });
    }
    if (rec.status === 'running') {
      // A late answer after an attach timeout still wins: the run is live after all.
      adopt(rec);
      return;
    }
    // A finished run from the host's memory: only over our copy of the same run that still says
    // running (its final write failed). It never replaces another run or touches Start.
    const cur = useCouncil.getState().record;
    if (cur?.runId === rec.runId && cur.status !== 'done') {
      useCouncil.setState({ record: rec });
      void saveIfStillRunning(rec).catch(() => {});
    }
    return;
  }
  if (msg.type === 'rejected') {
    if (pendingStart && msg.runId === pendingStart.runId) {
      pendingStart = null;
      useCouncil.setState({ rejected: msg.error, starting: false });
    }
    return;
  }
  const rec = useCouncil.getState().record;
  if (!rec || rec.runId !== msg.runId) return;
  if (msg.type === 'turn') {
    const turns = [...rec.turns];
    turns[msg.index] = msg.turn;
    useCouncil.setState({ record: { ...rec, turns } });
  } else {
    useCouncil.setState({
      record: {
        ...rec,
        status: msg.status,
        verdict: msg.verdict ?? null,
        ...(msg.summaryText ? { summaryText: msg.summaryText } : {}),
        ...(msg.error ? { error: msg.error } : {}),
      },
    });
  }
}

function dropPort(): void {
  const p = port;
  port = null;
  try {
    p?.disconnect();
  } catch {}
}

/**
 * Mark the run interrupted and show it. The write is conditional on the `updatedAt` we saw, so a
 * live host's newer write wins. When we know the host is gone (`gone`), our copy may just be
 * older than the host's last turn write: re-read it and mark that one.
 */
async function interrupt(rec: CouncilRecord, gone: boolean): Promise<void> {
  let next = await markInterrupted(rec.runId, rec.updatedAt).catch(() => null);
  if (!next && gone) {
    const stored = await getRun(rec.runId).catch(() => null);
    if (stored?.status === 'running')
      next = await markInterrupted(rec.runId, stored.updatedAt).catch(() => null);
  }
  const cur = useCouncil.getState().record;
  if (cur?.runId !== rec.runId || cur.status !== 'running') return;
  const stored = next ?? (await getRun(rec.runId).catch(() => null));
  useCouncil.setState({
    record:
      stored && stored.status !== 'running'
        ? stored
        : gone
          ? { ...rec, status: 'interrupted' }
          : (stored ?? rec),
  });
}

/** One long-lived Port per panel: it hears every run the host starts, from any window. */
function openPort(): PortLike | null {
  if (port) return port;
  let p: PortLike;
  try {
    p = councilIo.connect();
  } catch {
    return null;
  }
  port = p;
  p.onMessage.addListener((msg) => {
    if (port === p) onHostMsg(msg);
  });
  p.onDisconnect.addListener(() => onLost(p));
  return p;
}

/** Ask the host for its run; when we expect `expect` to be live, time the answer out. */
function attach(expect: CouncilRecord | null): void {
  const p = openPort();
  if (!p) {
    if (expect) void interrupt(expect, true);
    return;
  }
  if (expect && !awaiting) {
    const runId = expect.runId;
    const timer = setTimeout(() => {
      if (awaiting?.runId !== runId) return;
      awaiting = null;
      // No answer: probably dead, but a slow host may still answer (then the snapshot wins).
      const cur = useCouncil.getState().record;
      if (cur?.runId === runId && cur.status === 'running') void interrupt(cur, false);
    }, councilIo.attachTimeoutMs);
    awaiting = { runId, timer };
  }
  try {
    p.postMessage({ type: 'attach' });
  } catch {
    onLost(p);
  }
}

/** The host went away under us: a run that still looks live was interrupted. */
function onLost(p: PortLike): void {
  if (port !== p) return;
  port = null;
  if (awaiting) clearTimeout(awaiting.timer);
  awaiting = null;
  if (pendingStart) {
    pendingStart = null;
    useCouncil.setState({ starting: false, rejected: LOST_HOST });
    return;
  }
  const rec = useCouncil.getState().record;
  if (rec?.status === 'running') void interrupt(rec, true);
}

let watching: (() => void) | null = null;

function watch(): void {
  if (watching) return;
  const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && SEEN_KEY in changes) {
      const v = changes[SEEN_KEY]?.newValue;
      useCouncil.setState({ seen: typeof v === 'string' ? v : null });
    }
  };
  // The host tells the SW when a run starts or ends; every extension page hears it. A panel
  // with no Port yet (no offscreen document when it opened) connects now.
  const onMsg = (msg: unknown) => {
    const t = (msg as { type?: string } | null)?.type;
    if (t === 'council.started') attach(null);
    else if (t === 'council.finished' && !port) void refresh();
    return false;
  };
  try {
    chrome.storage.onChanged.addListener(onChange);
    chrome.runtime.onMessage?.addListener(onMsg);
  } catch {}
  watching = () => {
    try {
      chrome.storage.onChanged.removeListener(onChange);
      chrome.runtime.onMessage?.removeListener(onMsg);
    } catch {}
  };
}

async function refresh(): Promise<void> {
  const rec = await latestRun().catch(() => null);
  if (rec) adopt(rec);
}

/** Load the newest run, attach to the host (if there is one), and follow `council.seen`. */
export async function initCouncil(): Promise<void> {
  if (!watching) {
    watch();
    try {
      const got = await chrome.storage.local.get(SEEN_KEY);
      const v = got[SEEN_KEY];
      useCouncil.setState({ seen: typeof v === 'string' ? v : null });
    } catch {}
  }
  if (useCouncil.getState().loaded) return;
  const rec = await latestRun().catch(() => null);
  useCouncil.setState((s) => ({
    loaded: true,
    record: s.record ?? rec,
    context: s.context || rec?.context || '',
  }));
  if (port) return;
  const running = rec?.status === 'running' ? rec : null;
  if (await councilIo.hasOffscreen()) attach(running);
  else if (running) await interrupt(running, true);
}

export async function startCouncil(input: {
  scan: DesignScan;
  provider: ProviderSpec;
}): Promise<void> {
  const s = useCouncil.getState();
  if (s.starting || s.record?.status === 'running') return;
  useCouncil.setState({ starting: true, rejected: null });
  const runId = crypto.randomUUID();
  const spec = JSON.stringify(input.provider);
  try {
    await councilIo.ensure();
    // The document may have just been created, so no SW halt could reach it before now: read the
    // flag and the settings again. A change after `resolvedAt` reaches the host as a halt, and the
    // host refuses or stops a run whose settings are older than that.
    const resolvedAt = Date.now();
    if ((await currentSpec()) !== spec) {
      useCouncil.setState({ starting: false, rejected: SETTINGS_CHANGED });
      return;
    }
    const p = openPort();
    if (!p) throw new Error('no port');
    pendingStart = { runId };
    p.postMessage({
      type: 'start',
      v: COUNCIL_V,
      runId,
      scan: input.scan,
      provider: input.provider,
      personas: s.personas,
      rounds: s.rounds,
      context: s.context,
      resolvedAt,
    });
  } catch {
    pendingStart = null;
    dropPort();
    useCouncil.setState({ starting: false, rejected: LOST_HOST });
  }
}

export function stopCouncil(): void {
  const runId =
    pendingStart?.runId ??
    (useCouncil.getState().record?.status === 'running'
      ? useCouncil.getState().record?.runId
      : null);
  if (!runId) return;
  try {
    port?.postMessage({ type: 'stop', runId });
  } catch {}
}

/** The panel has shown this finished run: back to idle, and the SW clears the badge. */
export function markSeen(runId: string): void {
  if (useCouncil.getState().seen === runId) return;
  useCouncil.setState({ seen: runId });
  try {
    void chrome.storage.local.set({ [SEEN_KEY]: runId }).catch(() => {});
  } catch {}
}

/** Header mascot: thinking while a run is live, happy when a verdict waits unseen. */
export function moodFor(
  rec: CouncilRecord | null,
  seen: string | null,
  scanning: boolean,
): MascotMood {
  if (scanning) return 'scanning';
  if (!rec) return 'idle';
  if (rec.status === 'running') return 'thinking';
  if (seen === rec.runId || rec.status === 'stopped') return 'idle';
  return rec.status === 'done' ? 'happy' : 'sad';
}

/** Tests only. */
export function _resetCouncil(): void {
  dropPort();
  pendingStart = null;
  if (awaiting) clearTimeout(awaiting.timer);
  awaiting = null;
  watching?.();
  watching = null;
  useCouncil.setState({
    record: null,
    loaded: false,
    seen: null,
    rejected: null,
    starting: false,
    personas: DEFAULT_PERSONAS,
    rounds: 2,
    context: '',
  });
}
