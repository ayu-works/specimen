/**
 * The council host (SPC-24): runs one council at a time in the offscreen document, so the run
 * survives the side panel closing. Panels attach over Port `council` (protocol v1,
 * `lib/councilProtocol.ts`). The provider config, key included, lives only in this run's closure.
 * Every post to a Port is guarded: a closed panel never breaks the run.
 */
import {
  type CritiqueOptions,
  clipContext,
  createChromeBuiltin,
  createWebLLMProvider,
  critiquePlan,
  getPreset,
  isChromeBuiltinAvailable,
  type LLMProvider,
  type PortLike,
  runCritique,
} from '@specimen/ai';
import { resolveByokProvider } from '@/lib/aiByok';
import { putRun } from '@/lib/councilDb';
import {
  COUNCIL_PORT,
  COUNCIL_REJECT,
  type CouncilRecord,
  type CouncilRuntimeMsg,
  type HostMsg,
  type PanelMsg,
  type ProviderSpec,
  parsePanelMsg,
} from '@/lib/councilProtocol';
import { createPortPair } from '@/lib/localPort';
import { attachLlmPort } from './llmHost';

/** The bits of a Port the host uses (a real `chrome.runtime.Port`, or a test fake). */
export interface HostPort {
  postMessage(msg: HostMsg): void;
  onMessage: { addListener(cb: (m: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

export interface HostDeps {
  /** Build the provider for one run; throw (or return null) when it can't run here. */
  makeProvider: (spec: ProviderSpec) => Promise<LLMProvider | null>;
  /** Tell the service worker (badge). Never carries a key. */
  notify: (msg: CouncilRuntimeMsg) => void;
  put?: (rec: CouncilRecord) => Promise<void>;
  now?: () => number;
  /** Test knobs passed to the engine (shorter retry/pacing/stall waits). */
  engine?: Pick<CritiqueOptions, 'retryDelaysMs' | 'tokensPerMinute' | 'paceWindowMs' | 'stallMs'>;
}

const ENDED = new Set(['done', 'stopped', 'error', 'filtered', 'empty']);

export function createCouncilHost(deps: HostDeps) {
  const now = deps.now ?? Date.now;
  const put = deps.put ?? putRun;
  const ports = new Set<HostPort>();
  let live: { record: CouncilRecord; ctl: AbortController } | null = null;

  const post = (port: HostPort, msg: HostMsg) => {
    try {
      port.postMessage(msg);
    } catch {
      // Chrome throws on a disconnected Port: drop it, the run goes on.
      ports.delete(port);
    }
  };
  const broadcast = (msg: HostMsg) => {
    for (const p of [...ports]) post(p, msg);
  };
  const notify = (msg: CouncilRuntimeMsg) => {
    try {
      deps.notify(msg);
    } catch {}
  };
  /** Fire-and-forget write: a failed write never breaks the run. */
  const save = (rec: CouncilRecord) => put(structuredClone(rec)).catch(() => {});

  async function start(port: HostPort, msg: Extract<PanelMsg, { type: 'start' }>) {
    if (live) {
      // One run per extension: a second start gets the live run.
      post(port, { type: 'snapshot', record: live.record });
      return;
    }
    let provider: LLMProvider | null = null;
    try {
      provider = await deps.makeProvider(msg.provider);
    } catch {
      provider = null;
    }
    if (!provider) {
      post(port, { type: 'rejected', runId: msg.runId, error: COUNCIL_REJECT.provider });
      return;
    }
    if (live) {
      post(port, { type: 'snapshot', record: (live as { record: CouncilRecord }).record });
      return;
    }
    const { scan } = msg;
    const plan = critiquePlan(provider, scan, { personas: msg.personas, rounds: msg.rounds });
    const t = now();
    const record: CouncilRecord = {
      v: 1,
      runId: msg.runId,
      scanId: scan.id,
      scanHost: scan.host,
      status: 'running',
      plan: {
        personas: plan.personas,
        rounds: plan.rounds,
        totalTurns: plan.totalTurns,
        providerLabel: provider.label,
      },
      context: clipContext(msg.context),
      turns: [],
      verdict: null,
      startedAt: t,
      updatedAt: t,
    };
    const ctl = new AbortController();
    live = { record, ctl };
    notify({ type: 'council.started', runId: record.runId });
    broadcast({ type: 'snapshot', record });
    // Stored before the first call, so a panel reopened right away finds the run.
    await save(record);

    try {
      const r = await runCritique(provider, scan, {
        ...deps.engine,
        personas: plan.personas,
        rounds: plan.rounds,
        context: record.context,
        signal: ctl.signal,
        onTurn: (index, turn) => {
          record.turns[index] = turn;
          broadcast({ type: 'turn', runId: record.runId, index, turn });
          if (ENDED.has(turn.status)) {
            record.updatedAt = now();
            void save(record);
          }
        },
      });
      record.status = r.status;
      record.turns = r.turns;
      record.verdict = r.verdict;
      if (r.summaryText) record.summaryText = r.summaryText;
      if (r.error) record.error = r.error;
    } catch {
      record.status = 'error';
      record.error = COUNCIL_REJECT.error;
    }
    record.updatedAt = now();
    // The final state: one retry, then give up (a reattach marks a stuck `running` interrupted).
    await put(structuredClone(record)).catch(() => put(structuredClone(record)).catch(() => {}));
    live = null;
    broadcast({
      type: 'status',
      runId: record.runId,
      status: record.status,
      verdict: record.verdict,
      ...(record.summaryText ? { summaryText: record.summaryText } : {}),
      ...(record.error ? { error: record.error } : {}),
    });
    notify({ type: 'council.finished', runId: record.runId, status: record.status });
  }

  return {
    /** Serve one panel's Port. */
    attach(port: HostPort): void {
      ports.add(port);
      port.onDisconnect.addListener(() => ports.delete(port));
      port.onMessage.addListener((raw) => {
        const parsed = parsePanelMsg(raw);
        if (!parsed.ok) {
          post(port, { type: 'rejected', runId: parsed.runId, error: parsed.error });
          return;
        }
        const msg = parsed.msg;
        if (msg.type === 'attach') post(port, { type: 'snapshot', record: live?.record ?? null });
        else if (msg.type === 'stop') {
          if (live?.record.runId === msg.runId) live.ctl.abort();
        } else void start(port, msg).catch(() => {});
      });
    },
    /**
     * The service worker saw the flag, the provider or a key change at `at`. A run started after
     * that already uses the new settings, so it is left alone.
     */
    halt(at: number): void {
      if (live && live.record.startedAt <= at) live.ctl.abort();
    },
    get liveRunId(): string | null {
      return live?.record.runId ?? null;
    },
  };
}

/** The real provider for a spec, built in this document. Null when it can't run here. */
export async function makeProvider(spec: ProviderSpec): Promise<LLMProvider | null> {
  if (spec.kind === 'byok') {
    const preset = getPreset(spec.cfg.preset);
    if (!preset) return null;
    return resolveByokProvider(preset, spec.cfg);
  }
  if (spec.kind === 'webllm') {
    return createWebLLMProvider({
      modelId: spec.cfg.modelId,
      contextTokens: spec.cfg.contextTokens,
      // Same engine and queue as Ask, through an in-page Port pair.
      connect: () => {
        const [client, host] = createPortPair('llm');
        attachLlmPort(host as unknown as chrome.runtime.Port);
        return client as unknown as PortLike;
      },
    });
  }
  return (await isChromeBuiltinAvailable()) ? createChromeBuiltin() : null;
}

export function startCouncilHost(): void {
  const host = createCouncilHost({
    makeProvider,
    notify: (msg) => {
      chrome.runtime.sendMessage(msg).catch(() => {});
    },
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === COUNCIL_PORT) host.attach(port as unknown as HostPort);
  });
  // Only the service worker's halt; every other runtime message is someone else's.
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    const m = msg as Partial<CouncilRuntimeMsg> | null;
    if (m?.type !== 'council.halt' || typeof m.at !== 'number') return false;
    host.halt(m.at);
    sendResponse({ ok: true });
    return false;
  });
}
