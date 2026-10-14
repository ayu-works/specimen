import { computeA11y } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';
import { mapThrown } from '../errors';
import type { ChatRequest, LLMProvider, ProviderErrorKind } from '../types';
import { safe } from './collect';
import { compactScan, PAGE_DATA_RULE, pageDataBudget, wrapPageData } from './pageData';

/**
 * Critique panel (SPC-22 spike): one provider plays 2–3 reviewer personas who discuss the same
 * measured scan in rounds, the human can steer between turns, and a final turn writes a
 * keep / change list. Every turn is grounded in the scan inside `<page_data>` and sanitized.
 */

export type PersonaId = 'brand' | 'a11y' | 'frontend' | 'skeptic';

export const PERSONAS: Record<PersonaId, { name: string; brief: string }> = {
  brand: {
    name: 'Brand designer',
    brief:
      'You are a brand designer. You judge visual identity: the palette and how the accent is used, the type pairing and scale, the overall mood, and whether it all feels consistent.',
  },
  a11y: {
    name: 'Accessibility reviewer',
    brief:
      'You are an accessibility reviewer. You judge contrast (quote the measured ratios and whether they pass AA or only AA-large), type sizes and line heights for readability, the legibility of links and muted text, and the color scheme.',
  },
  frontend: {
    name: 'Front-end developer',
    brief:
      'You are a front-end developer. You judge how systematic the design is: whether spacing follows a clean scale on the base unit, how many radii, shadows and font sizes there are, how easily it turns into tokens, the container and the breakpoints, and how hard it is to rebuild.',
  },
  skeptic: {
    name: 'Skeptic',
    brief:
      "You are the panel's skeptic. You challenge the other reviewers' claims against the measured numbers and point out what they got wrong or overstated.",
  },
};

export const DEFAULT_PERSONAS: PersonaId[] = ['brand', 'a11y', 'frontend'];
export const CRITIQUE_LIMITS = { minPersonas: 2, maxPersonas: 3, minRounds: 1, maxRounds: 3 };
const DEFAULT_ROUNDS = 2;
/** Reasoning models (Groq's default gpt-oss) count thinking against this, so it is generous. */
const TURN_MAX_TOKENS = 1200;
const SUMMARY_MAX_TOKENS = 1500;
/** Expected visible output per turn, for the cost estimate. */
const EXPECTED_TURN_TOKENS = 250;
const MAX_HUMAN = 1000;
const MAX_ENTRY = 1200;
const CONTRAST_PAIRS = 12;
/** The user message never gets a budget below this (it always fits the latest Human message). */
export const MESSAGE_FLOOR = 2000;
const OMITTED = '[earlier discussion omitted]';
/**
 * Waits before each retry of a rate-limited turn (at most 3 retries, ~80 s in all). Groq's free
 * tier counts tokens per minute, so the wait has to cover most of a minute.
 */
export const DEFAULT_RETRY_DELAYS_MS = [20_000, 30_000, 30_000];
/**
 * Known free-tier tokens-per-minute limits, by provider id. The panel paces its calls under
 * these so a default run waits instead of failing (Groq free tier: 8K TPM for gpt-oss-20b).
 */
export const PROVIDER_TPM: Record<string, number> = { groq: 8000 };
const PACE_WINDOW_MS = 60_000;

/** A turn with no text for this long counts as stalled (the first wait covers a local model load). */
export const DEFAULT_STALL_MS = { first: 120_000, gap: 30_000 };
export const STALLED_ERROR =
  'The provider stopped responding. Try again, or pick another model in Settings.';

const SHARED_RULES = [
  'You are on a small panel critiquing one website design. Use only the measured data below. If something was not measured (hover states, animation, copy, imagery), say so instead of guessing.',
  'Do not name the website, its brand or its products, and do not quote its headlines.',
].join(' ');

export const SUMMARY_BRIEF =
  "You are the panel's moderator. Turn the discussion into a short decision list. Reflect the Human's priorities when the Human spoke.";

const SUMMARY_INSTRUCTION = [
  'Write the final list now, in exactly this format and nothing else:',
  'Keep:',
  '- (up to 5 bullets)',
  'Change:',
  '- (up to 5 bullets)',
  'Each bullet is at most 20 words and cites a measured value (hex, px or ratio).',
].join('\n');

/** Fixed per-kind text: adapters can echo provider bodies, which must never reach the UI. */
export const CRITIQUE_ERRORS: Record<Exclude<ProviderErrorKind, 'aborted'>, string> = {
  auth: 'The provider rejected the API key. Check it in Settings.',
  rate: 'The provider is still rate-limiting requests. Wait a minute and start again, or use fewer reviewers or rounds.',
  network: "Can't reach the provider. Check your connection and try again.",
  unsupported: "This provider can't run the critique panel.",
  other: 'The provider returned an error. Try again, or pick another model in Settings.',
};

/** `empty` = the model returned no text (a reasoning model can spend its whole budget thinking). */
export type TurnStatus =
  | 'streaming'
  | 'waiting'
  | 'retrying'
  | 'done'
  | 'stopped'
  | 'error'
  | 'filtered'
  | 'empty';

export interface CritiqueTurn {
  kind: 'persona' | 'human' | 'summary';
  persona?: PersonaId;
  /** Sanitized text. */
  content: string;
  status: TurnStatus;
  /** Fixed, user-facing message for `error`. */
  error?: string;
  /** Set while `waiting` (pacing) or `retrying` (rate limited): how long, and until when (epoch ms). */
  retryInMs?: number;
  retryAt?: number;
}

export interface CritiqueOptions {
  personas?: PersonaId[];
  rounds?: number;
  signal?: AbortSignal;
  /** Called with a copy of the turn at `index` whenever it starts, streams or ends. */
  onTurn?: (index: number, turn: CritiqueTurn) => void;
  /** Drains the human's queued messages; called before every model turn. */
  takeHuman?: () => string[];
  /** Waits before each retry of a rate-limited turn; its length is the retry limit (tests shorten it). */
  retryDelaysMs?: number[];
  /** Pace calls under this many tokens per minute (default: `PROVIDER_TPM[provider.id]`; 0 = off). */
  tokensPerMinute?: number;
  /** The pacing window (tests shorten it). */
  paceWindowMs?: number;
  /** Stall timeouts: to the first text, and between pieces of text. */
  stallMs?: { first: number; gap: number };
}

export interface KeepChange {
  keep: string[];
  change: string[];
}

export interface CritiqueResult {
  status: 'done' | 'stopped' | 'error';
  turns: CritiqueTurn[];
  summary: KeepChange | null;
  error?: string;
}

export interface CritiquePlan {
  personas: PersonaId[];
  rounds: number;
  /** Model calls: personas × rounds + 1 summary (rate-limit retries excluded). */
  totalTurns: number;
  /** Rough tokens sent and received for a whole run, at the expected reply length. */
  estTokens: number;
  /** Upper bound: every reply uses its full `maxTokens` (reasoning models can). */
  maxTokens: number;
  /** The pacing limit in force (null = none), and the rough run time it implies. */
  tokensPerMinute: number | null;
  estMinutes: number | null;
}

function clampPersonas(list: PersonaId[] | undefined): PersonaId[] {
  const valid = [...new Set((list ?? []).filter((p) => p in PERSONAS))].slice(
    0,
    CRITIQUE_LIMITS.maxPersonas,
  );
  if (valid.length >= CRITIQUE_LIMITS.minPersonas) return valid;
  // Too few: top up from the defaults.
  for (const p of DEFAULT_PERSONAS) {
    if (valid.length >= CRITIQUE_LIMITS.minPersonas) break;
    if (!valid.includes(p)) valid.push(p);
  }
  return valid;
}

function clampRounds(n: number | undefined): number {
  const r = Number.isFinite(n) ? Math.round(n as number) : DEFAULT_ROUNDS;
  return Math.min(CRITIQUE_LIMITS.maxRounds, Math.max(CRITIQUE_LIMITS.minRounds, r));
}

/** The measured contrast pairs (worst first, capped), then the compact scan. */
export function critiqueGrounding(scan: DesignScan): string {
  const pairs = [...(scan.a11y?.pairs ?? computeA11y(scan.colors).pairs)]
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, CONTRAST_PAIRS)
    .map((p) => ({
      fg: p.fg,
      bg: p.bg,
      fgRole: p.fgRole ?? null,
      bgRole: p.bgRole ?? null,
      ratio: p.ratio,
      aa: p.aa,
      aaLarge: p.aaLarge,
    }));
  // Contrast first: wrapPageData truncates the tail on small-context providers.
  return `Measured contrast pairs (worst first): ${JSON.stringify(pairs)}\nMeasured design: ${compactScan(scan)}`;
}

export function critiqueSystemPrompt(
  provider: Pick<LLMProvider, 'capabilities'>,
  scan: DesignScan,
  role: PersonaId | 'summary',
): string {
  // The same prefix on every turn (rules + data) lets providers cache it; the role comes last.
  return [
    SHARED_RULES,
    PAGE_DATA_RULE,
    wrapPageData(critiqueGrounding(scan), pageDataBudget(provider.capabilities.contextTokens)),
    role === 'summary' ? SUMMARY_BRIEF : PERSONAS[role].brief,
  ].join('\n\n');
}

export function critiquePlan(
  provider: Pick<LLMProvider, 'capabilities' | 'id'>,
  scan: DesignScan,
  opts: Pick<CritiqueOptions, 'personas' | 'rounds' | 'tokensPerMinute'> = {},
): CritiquePlan {
  const personas = clampPersonas(opts.personas ?? DEFAULT_PERSONAS);
  const rounds = clampRounds(opts.rounds);
  const totalTurns = personas.length * rounds + 1;
  const systemTokens = Math.ceil(critiqueSystemPrompt(provider, scan, 'brand').length / 4);
  // Each call resends the system prompt plus the transcript so far.
  const transcript = (EXPECTED_TURN_TOKENS * (totalTurns * (totalTurns - 1))) / 2;
  const sent = totalTurns * systemTokens + transcript;
  const estTokens = sent + totalTurns * EXPECTED_TURN_TOKENS;
  const maxTokens =
    sent + (totalTurns - 1) * turnMaxTokens(provider, false) + turnMaxTokens(provider, true);
  const tpm = paceLimit(provider, opts.tokensPerMinute);
  return {
    personas,
    rounds,
    totalTurns,
    estTokens: Math.round(estTokens),
    maxTokens: Math.round(maxTokens),
    tokensPerMinute: tpm,
    // Pacing reserves each call's full maxTokens, so the upper bound sets the pace.
    estMinutes: tpm ? Math.max(1, Math.ceil(maxTokens / tpm)) : null,
  };
}

function paceLimit(provider: Pick<LLMProvider, 'id'>, override?: number): number | null {
  const tpm = override ?? PROVIDER_TPM[provider.id] ?? 0;
  return tpm > 0 ? tpm : null;
}

/** Tokens a call may count against a TPM limit: its input (≈ 3 chars/token for JSON) plus maxTokens. */
function callTokens(req: ChatRequest): number {
  const chars = (req.system?.length ?? 0) + String(req.messages[0]?.content ?? '').length;
  return Math.ceil(chars / 3) + (req.maxTokens ?? 0);
}

/** How long to wait so the calls in the last window plus `next` stay under `tpm`. */
export function paceWait(
  log: { at: number; tokens: number }[],
  next: number,
  tpm: number,
  windowMs: number,
  now: number,
): number {
  const live = log.filter((e) => now - e.at < windowMs).sort((a, b) => a.at - b.at);
  let sum = live.reduce((a, e) => a + e.tokens, 0);
  for (const e of live) {
    if (sum + next <= tpm) break;
    sum -= e.tokens;
    if (sum + next <= tpm || sum === 0) return Math.max(0, e.at + windowMs - now);
  }
  return 0;
}

/** Generous for reasoning models, but at most a quarter of a small (4k) context. */
function turnMaxTokens(provider: Pick<LLMProvider, 'capabilities'>, summary: boolean): number {
  const cap = summary ? SUMMARY_MAX_TOKENS : TURN_MAX_TOKENS;
  return Math.min(cap, Math.floor(provider.capabilities.contextTokens / 4));
}

function label(t: CritiqueTurn): string {
  if (t.kind === 'human') return 'Human';
  if (t.kind === 'summary') return 'Moderator';
  return t.persona ? PERSONAS[t.persona].name : 'Reviewer';
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Character budget for the user message of one turn. */
export function messageBudget(
  contextTokens: number,
  systemChars: number,
  maxTokens: number,
): number {
  return Math.max(MESSAGE_FLOOR, Math.floor(contextTokens * 3) - systemChars - maxTokens * 4);
}

/**
 * The discussion so far as one user message, then the instruction. Keeps the newest entries
 * (and always the latest Human message) within `budget` characters.
 */
export function renderTurnMessage(
  turns: CritiqueTurn[],
  instruction: string,
  budget: number,
): string {
  const entries = turns
    .filter((t) => t.status === 'done' && t.content.trim())
    .map((t) => ({
      human: t.kind === 'human',
      text: `[${label(t)}]: ${clip(t.content.trim(), MAX_ENTRY)}`,
    }));
  let lastHuman = -1;
  entries.forEach((e, i) => {
    if (e.human) lastHuman = i;
  });
  const fixed = instruction.length + OMITTED.length + 4;
  let used = lastHuman >= 0 ? (entries[lastHuman]?.text.length ?? 0) + 1 : 0;
  const kept: string[] = [];
  let full = false;
  let omitted = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as { text: string };
    if (i === lastHuman) {
      kept.unshift(e.text);
    } else if (!full && fixed + used + e.text.length + 1 <= budget) {
      kept.unshift(e.text);
      used += e.text.length + 1;
    } else {
      full = true;
      omitted = true;
    }
  }
  const body = kept.length ? kept.join('\n') : '(No one has spoken yet.)';
  return `${omitted ? `${OMITTED}\n` : ''}${body}\n\n${instruction}`;
}

function personaInstruction(p: PersonaId, humanPending: boolean): string {
  return [
    `It is your turn as the ${PERSONAS[p].name}.`,
    humanPending ? 'First answer what the Human just said.' : '',
    'React to what the others said (agree or disagree), cite measured values (hex, px, ratios), and stay under 120 words. Do not start with your name.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Read "Keep:" / "Change:" bullet lists. Null when the text has neither. */
export function parseKeepChange(text: string): KeepChange | null {
  const out: KeepChange = { keep: [], change: [] };
  let cur: keyof KeepChange | null = null;
  let seen = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^[#*_\s]+|[*_\s]+$/g, '');
    // A heading is the word alone or followed by a colon ("Keeping…" / "Changes like…" are prose).
    const head = /^(keep|changes?)\b\s*(?::\s*(.*))?$/i.exec(line);
    if (head && !/^(?:[-*•]|\d+[.)])\s/.test(raw.trim())) {
      cur = (head[1] as string).toLowerCase().startsWith('keep') ? 'keep' : 'change';
      seen = true;
      const rest = (head[2] ?? '').trim();
      if (rest) out[cur].push(rest);
      continue;
    }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(raw);
    if (cur && bullet?.[1]) out[cur].push(bullet[1].trim());
  }
  if (!seen || out.keep.length + out.change.length === 0) return null;
  out.keep = out.keep.slice(0, 5);
  out.change = out.change.slice(0, 5);
  return out;
}

/** Resolves true after `ms`, or false as soon as `signal` aborts. */
function backoff(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type Step = { kind: 'persona'; persona: PersonaId } | { kind: 'summary' };

/**
 * Run the panel. Never throws for provider failures: the result says `stopped` or `error`, and
 * the turns made so far are kept.
 */
export async function runCritique(
  provider: LLMProvider,
  scan: DesignScan,
  opts: CritiqueOptions = {},
): Promise<CritiqueResult> {
  const { personas, rounds, tokensPerMinute: tpm } = critiquePlan(provider, scan, opts);
  const { signal } = opts;
  const windowMs = opts.paceWindowMs ?? PACE_WINDOW_MS;
  const paceLog: { at: number; tokens: number }[] = [];
  const turns: CritiqueTurn[] = [];
  const emit = (i: number) => {
    const t = turns[i];
    if (t) opts.onTurn?.(i, { ...t });
  };
  const done = (status: CritiqueResult['status'], error?: string): CritiqueResult => ({
    status,
    turns: turns.map((t) => ({ ...t })),
    summary: null,
    ...(error ? { error } : {}),
  });

  const steps: Step[] = [];
  for (let r = 0; r < rounds; r++)
    for (const p of personas) steps.push({ kind: 'persona', persona: p });
  steps.push({ kind: 'summary' });

  for (const step of steps) {
    if (signal?.aborted) return done('stopped');
    let humanPending = false;
    for (const raw of opts.takeHuman?.() ?? []) {
      const text = raw.trim().slice(0, MAX_HUMAN);
      if (!text) continue;
      turns.push({ kind: 'human', content: text, status: 'done' });
      emit(turns.length - 1);
      humanPending = true;
    }

    const role = step.kind === 'summary' ? 'summary' : step.persona;
    const system = critiqueSystemPrompt(provider, scan, role);
    const maxTokens = turnMaxTokens(provider, step.kind === 'summary');
    const instruction =
      step.kind === 'summary'
        ? SUMMARY_INSTRUCTION
        : personaInstruction(step.persona, humanPending);
    const req: ChatRequest = {
      system,
      messages: [
        {
          role: 'user',
          content: renderTurnMessage(
            turns,
            instruction,
            messageBudget(provider.capabilities.contextTokens, system.length, maxTokens),
          ),
        },
      ],
      maxTokens,
      temperature: step.kind === 'summary' ? 0.3 : 0.6,
    };

    const turn: CritiqueTurn =
      step.kind === 'summary'
        ? { kind: 'summary', content: '', status: 'streaming' }
        : { kind: 'persona', persona: step.persona, content: '', status: 'streaming' };
    const idx = turns.push(turn) - 1;
    emit(idx);

    if (tpm) {
      const tokens = callTokens(req);
      const wait = paceWait(paceLog, tokens, tpm, windowMs, Date.now());
      if (wait > 0) {
        turn.status = 'waiting';
        turn.retryInMs = wait;
        turn.retryAt = Date.now() + wait;
        emit(idx);
        const ok = await backoff(wait, signal);
        delete turn.retryInMs;
        delete turn.retryAt;
        if (!ok) {
          turn.status = 'stopped';
          emit(idx);
          return done('stopped');
        }
        turn.status = 'streaming';
        emit(idx);
      }
      paceLog.push({ at: Date.now(), tokens });
    }

    const outcome = await runTurn(provider, scan, req, turn, () => emit(idx), opts);
    if (outcome.status === 'stopped') return done('stopped');
    if (outcome.status === 'error') return done('error', outcome.error);
  }

  const last = turns[turns.length - 1];
  return {
    status: 'done',
    turns: turns.map((t) => ({ ...t })),
    summary: last?.status === 'done' ? parseKeepChange(last.content) : null,
  };
}

async function runTurn(
  provider: LLMProvider,
  scan: DesignScan,
  req: ChatRequest,
  turn: CritiqueTurn,
  emit: () => void,
  opts: CritiqueOptions,
): Promise<{ status: 'done' | 'stopped' | 'error'; error?: string }> {
  const { signal } = opts;
  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const stall = opts.stallMs ?? DEFAULT_STALL_MS;
  const stop = () => {
    turn.status = 'stopped';
    emit();
    return { status: 'stopped' as const };
  };
  const fail = (message: string) => {
    turn.status = 'error';
    turn.error = message;
    emit();
    return { status: 'error' as const, error: message };
  };
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) return stop();
    // Per-attempt signal: the run's Stop, or a stall timer that restarts on every piece of text.
    const attemptCtl = new AbortController();
    const onAbort = () => attemptCtl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        attemptCtl.abort();
      }, ms);
    };
    arm(stall.first);
    let raw = '';
    let thrown: unknown = null;
    try {
      for await (const d of provider.chat(req, attemptCtl.signal)) {
        arm(stall.gap);
        raw += d;
        turn.content = safe(raw, scan);
        emit();
      }
    } catch (e) {
      thrown = e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    // Stop wins; some hosts end the stream quietly on abort instead of throwing.
    if (signal?.aborted) return stop();
    if (stalled) return fail(STALLED_ERROR);
    if (thrown) {
      const err = mapThrown(thrown);
      if (err.kind === 'aborted') return stop();
      const wait = delays[attempt];
      if (err.kind === 'rate' && wait !== undefined) {
        turn.content = '';
        turn.status = 'retrying';
        turn.retryInMs = wait;
        turn.retryAt = Date.now() + wait;
        emit();
        const ok = await backoff(wait, signal);
        delete turn.retryInMs;
        delete turn.retryAt;
        if (!ok) return stop();
        turn.status = 'streaming';
        emit();
        continue;
      }
      return fail(CRITIQUE_ERRORS[err.kind]);
    }
    turn.content = safe(raw, scan);
    turn.status = !raw.trim() ? 'empty' : !turn.content.trim() ? 'filtered' : 'done';
    emit();
    return { status: 'done' };
  }
}
