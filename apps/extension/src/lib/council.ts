/**
 * Side-panel side of the council (SPC-24). The run lives in the offscreen host; this store reads
 * the newest stored record, reattaches to a live run over Port `council`, and marks a run whose
 * host is gone `interrupted` so the mascot never thinks forever.
 */
import { DEFAULT_PERSONAS, MAX_CONTEXT, type PersonaId } from '@specimen/ai';
import type { DesignScan } from '@specimen/core/schema';
import { create } from 'zustand';
import type { MascotMood } from '@/components/Mascot';
import { latestRun, markInterrupted } from './councilDb';
import {
  COUNCIL_PORT,
  COUNCIL_V,
  type CouncilRecord,
  type HostMsg,
  type PanelMsg,
  type ProviderSpec,
  SEEN_KEY,
} from './councilProtocol';
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

function apply(msg: HostMsg): void {
  const s = useCouncil.getState();
  if (msg.type === 'snapshot') {
    if (msg.record) useCouncil.setState({ record: msg.record, starting: false, rejected: null });
    return;
  }
  if (msg.type === 'rejected') {
    useCouncil.setState({ rejected: msg.error, starting: false });
    return;
  }
  const rec = s.record;
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
    dropPort();
  }
}

function dropPort(): void {
  const p = port;
  port = null;
  try {
    p?.disconnect();
  } catch {}
}

/** Mark the run interrupted (only if nobody updated it meanwhile) and show it. */
async function interrupt(rec: CouncilRecord): Promise<void> {
  const next = await markInterrupted(rec.runId, rec.updatedAt).catch(() => null);
  const cur = useCouncil.getState().record;
  if (cur?.runId !== rec.runId) return;
  // Someone else (the host itself) updated it: show the stored truth.
  const stored = next ?? (await latestRun().catch(() => null));
  useCouncil.setState({
    record: stored?.runId === rec.runId ? stored : { ...rec, status: 'interrupted' },
  });
}

/** Connect to a host we believe holds `rec`; anything but its live snapshot → interrupted. */
async function reattach(rec: CouncilRecord): Promise<void> {
  if (!(await councilIo.hasOffscreen())) return interrupt(rec);
  let p: PortLike;
  try {
    p = councilIo.connect();
  } catch {
    return interrupt(rec);
  }
  port = p;
  let answered = false;
  const timer = setTimeout(() => {
    if (answered) return;
    answered = true;
    if (port === p) dropPort();
    void interrupt(rec);
  }, councilIo.attachTimeoutMs);
  p.onMessage.addListener((msg) => {
    if (!answered && msg.type === 'snapshot') {
      answered = true;
      clearTimeout(timer);
      if (msg.record?.runId !== rec.runId) {
        if (port === p) dropPort();
        void interrupt(rec);
        return;
      }
    }
    if (port === p) apply(msg);
  });
  p.onDisconnect.addListener(() => onLost(p, timer));
  try {
    p.postMessage({ type: 'attach' });
  } catch {
    onLost(p, timer);
  }
}

/** The host went away under us: if the run still looks live, it was interrupted. */
function onLost(p: PortLike, timer?: ReturnType<typeof setTimeout>) {
  if (port !== p) return;
  port = null;
  clearTimeout(timer);
  if (useCouncil.getState().starting) {
    useCouncil.setState({
      starting: false,
      rejected: 'Could not reach the council host. Reload the extension and try again.',
    });
    return;
  }
  const rec = useCouncil.getState().record;
  if (rec?.status === 'running') void interrupt(rec);
}

let seenWatch: (() => void) | null = null;

/** Load the newest run, reattach if it's running, and follow `council.seen`. Idempotent. */
export async function initCouncil(): Promise<void> {
  if (!seenWatch) {
    const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && SEEN_KEY in changes) {
        const v = changes[SEEN_KEY]?.newValue;
        useCouncil.setState({ seen: typeof v === 'string' ? v : null });
      }
    };
    try {
      chrome.storage.onChanged.addListener(onChange);
      seenWatch = () => chrome.storage.onChanged.removeListener(onChange);
    } catch {}
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
  if (rec?.status === 'running') await reattach(rec);
  // A live host may hold a run the store doesn't show yet (its first write is still landing).
  else await probe();
}

/** Ask a live host for its run without assuming there is one. */
async function probe(): Promise<void> {
  if (!(await councilIo.hasOffscreen())) return;
  let p: PortLike;
  try {
    p = councilIo.connect();
  } catch {
    return;
  }
  port = p;
  let first = true;
  p.onMessage.addListener((msg) => {
    if (port !== p) return;
    if (first && msg.type === 'snapshot') {
      first = false;
      if (msg.record?.status !== 'running') {
        dropPort();
        return;
      }
    }
    apply(msg);
  });
  p.onDisconnect.addListener(() => onLost(p));
  try {
    p.postMessage({ type: 'attach' });
  } catch {
    if (port === p) port = null;
  }
}

export async function startCouncil(input: {
  scan: DesignScan;
  provider: ProviderSpec;
}): Promise<void> {
  const s = useCouncil.getState();
  if (s.starting || s.record?.status === 'running') return;
  useCouncil.setState({ starting: true, rejected: null });
  const runId = crypto.randomUUID();
  try {
    await councilIo.ensure();
    dropPort();
    const p = councilIo.connect();
    port = p;
    p.onMessage.addListener((msg) => {
      if (port === p) apply(msg);
    });
    p.onDisconnect.addListener(() => onLost(p));
    p.postMessage({
      type: 'start',
      v: COUNCIL_V,
      runId,
      scan: input.scan,
      provider: input.provider,
      personas: s.personas,
      rounds: s.rounds,
      context: s.context,
    });
  } catch {
    dropPort();
    useCouncil.setState({
      starting: false,
      rejected: 'Could not reach the council host. Reload the extension and try again.',
    });
  }
}

export function stopCouncil(): void {
  const rec = useCouncil.getState().record;
  if (rec?.status !== 'running') return;
  try {
    port?.postMessage({ type: 'stop', runId: rec.runId });
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
  seenWatch?.();
  seenWatch = null;
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
