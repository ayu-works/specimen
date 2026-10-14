/**
 * The council's Port protocol, v1 (SPC-24, frozen by the PE; changes go through the PE).
 * The run lives in the offscreen document (`offscreen/councilHost.ts`); side panels attach to it
 * over Port `council`. The provider config, key included, travels only in `start` and stays in
 * the host's memory for that run: it is never in a record or in any host → panel message.
 */
import {
  CRITIQUE_LIMITS,
  type CritiqueTurn,
  PERSONAS,
  type PersonaId,
  type Verdict,
} from '@specimen/ai';
import type { DesignScan } from '@specimen/core/schema';

export const COUNCIL_PORT = 'council';
export const COUNCIL_V = 1;

export type ProviderSpec =
  | {
      kind: 'byok';
      cfg: { preset: string; baseUrl: string; model: string; apiKey?: string; vision: boolean };
    }
  | { kind: 'webllm'; cfg: { modelId: string; contextTokens: number } }
  | { kind: 'chrome' };

export type RunStatus = 'running' | 'done' | 'stopped' | 'error' | 'interrupted';

/** One stored run (IndexedDB `specimen-council`). Holds no key and no page data beyond the host. */
export interface CouncilRecord {
  v: 1;
  runId: string;
  scanId: string;
  /** Shown in the panel only; never sent to the model. */
  scanHost: string;
  status: RunStatus;
  plan: { personas: PersonaId[]; rounds: number; totalTurns: number; providerLabel: string };
  /** The user's goal, already clipped. */
  context: string;
  turns: CritiqueTurn[];
  verdict: Verdict | null;
  summaryText?: string;
  /** Fixed, user-facing text only. */
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export type PanelMsg =
  | {
      type: 'start';
      v: number;
      runId: string;
      scan: DesignScan;
      provider: ProviderSpec;
      personas: PersonaId[];
      rounds: number;
      context: string;
    }
  | { type: 'stop'; runId: string }
  | { type: 'attach' };

export type HostMsg =
  | { type: 'snapshot'; record: CouncilRecord | null }
  | { type: 'turn'; runId: string; index: number; turn: CritiqueTurn }
  | {
      type: 'status';
      runId: string;
      status: RunStatus;
      verdict?: Verdict | null;
      summaryText?: string;
      error?: string;
    }
  | { type: 'rejected'; runId: string | null; error: string };

/** Fixed rejection texts: a rejected start stores nothing and calls nothing. */
export const COUNCIL_REJECT = {
  malformed: 'The council could not start: the request was not understood. Reload the panel.',
  version: 'The council could not start: reload the panel after the extension updated.',
  provider: 'The council needs a local Gemma model or an API key provider. Pick one in Settings.',
  error: 'The council stopped because of an unexpected error. Start again.',
} as const;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isStr = (x: unknown): x is string => typeof x === 'string';

function validSpec(p: unknown): p is ProviderSpec {
  if (!isObj(p)) return false;
  if (p.kind === 'chrome') return true;
  const c = p.cfg;
  if (!isObj(c)) return false;
  if (p.kind === 'webllm') return isStr(c.modelId) && typeof c.contextTokens === 'number';
  if (p.kind === 'byok')
    return (
      isStr(c.preset) &&
      isStr(c.baseUrl) &&
      isStr(c.model) &&
      (c.apiKey === undefined || isStr(c.apiKey)) &&
      typeof c.vision === 'boolean'
    );
  return false;
}

/** Validate a panel message. Never throws; a bad one comes back as a fixed rejection. */
export function parsePanelMsg(
  m: unknown,
): { ok: true; msg: PanelMsg } | { ok: false; runId: string | null; error: string } {
  if (!isObj(m) || !isStr(m.type))
    return { ok: false, runId: null, error: COUNCIL_REJECT.malformed };
  const runId = isStr(m.runId) ? m.runId : null;
  if (m.type === 'attach') return { ok: true, msg: { type: 'attach' } };
  if (m.type === 'stop')
    return runId
      ? { ok: true, msg: { type: 'stop', runId } }
      : { ok: false, runId: null, error: COUNCIL_REJECT.malformed };
  if (m.type !== 'start') return { ok: false, runId, error: COUNCIL_REJECT.malformed };
  if (m.v !== COUNCIL_V) return { ok: false, runId, error: COUNCIL_REJECT.version };
  const scan = m.scan;
  const ok =
    runId &&
    isObj(scan) &&
    isStr(scan.id) &&
    isStr(scan.host) &&
    isObj(scan.colors) &&
    validSpec(m.provider) &&
    Array.isArray(m.personas) &&
    m.personas.every((p) => isStr(p) && p in PERSONAS) &&
    typeof m.rounds === 'number' &&
    m.rounds >= CRITIQUE_LIMITS.minRounds &&
    m.rounds <= CRITIQUE_LIMITS.maxRounds &&
    isStr(m.context);
  if (!ok) return { ok: false, runId, error: COUNCIL_REJECT.malformed };
  return { ok: true, msg: m as unknown as PanelMsg };
}

/** Runtime messages between the offscreen host and the service worker (never carry a key). */
export type CouncilRuntimeMsg =
  | { type: 'council.started'; runId: string }
  | { type: 'council.finished'; runId: string; status: RunStatus }
  | { type: 'council.halt'; at: number };

/** `chrome.storage.local`: the runId whose finished verdict a panel has shown. */
export const SEEN_KEY = 'council.seen';
