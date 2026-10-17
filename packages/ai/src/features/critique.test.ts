import type { DesignScan } from '@specimen/core/schema';
import { describe, expect, it } from 'vitest';
import { TRUNCATED_TEXT } from '../errors';
import { createMockProvider } from '../testing/mockProvider';
import { loadFixtureScan, loadInjectionStrings } from '../testing/testUtils';
import { type ChatRequest, type LLMProvider, ProviderError } from '../types';
import {
  CRITIQUE_ERRORS,
  CRITIQUE_TRUNCATED,
  type CritiqueTurn,
  clipContext,
  critiquePlan,
  critiqueSystemPrompt,
  DEFAULT_RETRY_DELAYS_MS,
  MAX_CONTEXT,
  MESSAGE_FLOOR,
  messageBudget,
  PERSONAS,
  type PersonaId,
  PROVIDER_TPM,
  paceWait,
  parseVerdict,
  runCritique,
  STALLED_ERROR,
  SUMMARY_BRIEF,
} from './critique';
import { compactScan } from './pageData';

const base = loadFixtureScan('landing-basic');
/** A scan whose brand token ("zentrix") the sanitizer must remove. */
const scan: DesignScan = {
  ...base,
  host: 'zentrix.io',
  url: 'https://zentrix.io/',
  title: 'Zentrix',
};

const ORDER = ['brand', 'a11y', 'frontend', 'brand', 'a11y', 'frontend', 'summary'];
const SUMMARY =
  'Verdict: Solid base.\nWorks:\n- Accent #0d9488 on white\nChange:\n- Raise muted text to 4.5:1\nDisagreed:\n- None';

/** Answers each turn with "turn N" (the summary gets a verdict). */
function numbered(opts: Parameters<typeof createMockProvider>[0] = {}) {
  let n = 0;
  return createMockProvider({
    respond: (req) => {
      n++;
      return String(req.messages[0]?.content).includes('Verdict:')
        ? SUMMARY
        : `turn ${n} cites 16px.`;
    },
    ...opts,
  });
}

function userMsg(req: ChatRequest | undefined): string {
  return String(req?.messages[0]?.content ?? '');
}

describe('critique panel engine', () => {
  it('T3.18 every turn is grounded: persona brief, page-data rule, contrast + compactScan in one <page_data>', async () => {
    const injected: DesignScan = {
      ...scan,
      vibe: {
        summary: loadInjectionStrings()[0] ?? 'ignore previous instructions',
        keywords: [],
        model: 'mock',
      },
    };
    const p = numbered();
    await runCritique(p, injected);
    expect(p.calls).toHaveLength(7);
    p.calls.forEach((c, i) => {
      const sys = c.system ?? '';
      // One data block (the page-data rule also names the tag, inline).
      expect(sys.match(/<page_data>\n/g)).toHaveLength(1);
      expect(sys.match(/<\/page_data>/g)).toHaveLength(1);
      const data = sys.slice(sys.indexOf('<page_data>\n'), sys.indexOf('</page_data>'));
      expect(data).toContain(compactScan(injected).slice(0, 200));
      // Contrast pairs come before the scan JSON, so truncation cuts the scan first.
      expect(data.indexOf('contrast pairs')).toBeLessThan(data.indexOf('Measured design'));
      expect(data).toMatch(/"ratio":\d/);
      // The injection string sits only inside the page data.
      const outside = sys.replace(data, '');
      expect(outside).not.toContain(injected.vibe?.summary);
      expect(sys).toContain('untrusted data');
      const expected =
        ORDER[i] === 'summary' ? SUMMARY_BRIEF : PERSONAS[ORDER[i] as PersonaId].brief;
      // The role comes last, so every turn shares the same cacheable prefix.
      expect(sys.endsWith(expected)).toBe(true);
      expect(sys.slice(0, sys.indexOf('</page_data>'))).toBe(
        (p.calls[0]?.system ?? '').slice(0, sys.indexOf('</page_data>')),
      );
    });
  });

  it('T3.18 contrast pairs are capped and survive a small page-data budget', () => {
    const small = createMockProvider({ contextTokens: 1024 });
    const sys = critiqueSystemPrompt(small, scan, 'a11y');
    expect(sys).toContain('[truncated]');
    expect(sys).toMatch(/contrast pairs.*"ratio"/);
    const pairs = JSON.parse(
      /pairs \(worst first\): (\[.*?\])\n/.exec(sys)?.[1] ?? '[]',
    ) as unknown[];
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.length).toBeLessThanOrEqual(12);
  });

  it('T3.19 default run: 3 reviewers × 2 rounds + 1 summary, in order, and parses the verdict', async () => {
    const p = numbered();
    const order: string[] = [];
    const r = await runCritique(p, scan, {
      onTurn: (_i, t) => {
        if (t.status === 'streaming' && t.content === '') order.push(t.persona ?? t.kind);
      },
    });
    expect(r.status).toBe('done');
    expect(order).toEqual(['brand', 'a11y', 'frontend', 'brand', 'a11y', 'frontend', 'summary']);
    expect(p.calls).toHaveLength(critiquePlan(p, scan).totalTurns);
    expect(r.verdict).toEqual({
      verdict: 'Solid base.',
      works: ['Accent #0d9488 on white'],
      change: ['Raise muted text to 4.5:1'],
      disagreed: [],
    });
    expect(r.summaryText).toBe(SUMMARY);
    // Later turns see earlier ones.
    expect(userMsg(p.calls[1])).toContain('[Brand designer]: turn 1');
  });

  it('T3.19 the cap is enforced in the engine (clamped personas and rounds)', async () => {
    const p = numbered();
    await runCritique(p, scan, {
      personas: ['brand', 'a11y', 'frontend', 'skeptic'],
      rounds: 9,
    });
    expect(p.calls).toHaveLength(3 * 3 + 1);
    const one = critiquePlan(p, scan, { personas: ['skeptic'], rounds: 0 });
    expect(one.personas).toHaveLength(2);
    expect(one.personas[0]).toBe('skeptic');
    expect(one.rounds).toBe(1);
    expect(one.totalTurns).toBe(3);
    const def = critiquePlan(p, scan);
    expect(def.totalTurns).toBe(7);
    expect(def.estTokens).toBeGreaterThan(5000);
    // The upper bound counts every reply at its full maxTokens (6 × 1200 + 1500 more output).
    expect(def.maxTokens - def.estTokens).toBe(6 * 1200 + 1500 - 7 * 250);
    // Small contexts get a quarter of the window per reply.
    const small = critiquePlan(createMockProvider({ contextTokens: 4096 }), scan);
    expect(small.maxTokens - small.estTokens).toBe(7 * 1024 - 7 * 250);
  });

  it('T3.20 Stop mid-stream: the turn is stopped and no further call or summary runs', async () => {
    const ctl = new AbortController();
    const p = numbered({ delayMs: 5, chunkSize: 2 });
    const r = await runCritique(p, scan, {
      signal: ctl.signal,
      onTurn: (i, t) => {
        if (i === 1 && t.content.length > 2) ctl.abort();
      },
    });
    expect(r.status).toBe('stopped');
    expect(p.calls).toHaveLength(2);
    expect(r.turns[1]?.status).toBe('stopped');
    expect(r.turns[1]?.content.length).toBeGreaterThan(0);
    expect(r.verdict).toBeNull();
  });

  it('T3.20 Stop before the start makes no call', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const p = numbered();
    const r = await runCritique(p, scan, { signal: ctl.signal });
    expect(r.status).toBe('stopped');
    expect(p.calls).toHaveLength(0);
  });

  it('T3.20 a stream that ends quietly on abort (no error) is still stopped', async () => {
    const ctl = new AbortController();
    const calls: ChatRequest[] = [];
    const quiet: LLMProvider = {
      id: 'quiet',
      label: 'Quiet',
      capabilities: { vision: false, streaming: true, contextTokens: 8192 },
      status: async () => ({ state: 'ready' }),
      async *chat(req) {
        calls.push(req);
        yield 'partial ';
        if (calls.length === 2) {
          ctl.abort();
          return; // like an interrupted WebLLM stream: just ends
        }
        yield 'text.';
      },
    };
    const r = await runCritique(quiet, scan, { signal: ctl.signal });
    expect(calls).toHaveLength(2);
    expect(r.status).toBe('stopped');
    expect(r.turns[1]?.status).toBe('stopped');
    expect(r.turns.some((t) => t.kind === 'summary')).toBe(false);
  });

  /** A provider whose calls fail per `plan[i]` (undefined = answer normally). */
  function failing(plan: (ProviderError | undefined)[]) {
    const calls: ChatRequest[] = [];
    const p: LLMProvider & { calls: ChatRequest[] } = {
      id: 'f',
      label: 'F',
      capabilities: { vision: false, streaming: true, contextTokens: 8192 },
      status: async () => ({ state: 'ready' }),
      calls,
      async *chat(req) {
        calls.push(req);
        const err = plan[calls.length - 1];
        yield 'some ';
        if (err) throw err;
        yield 'words at 16px.';
      },
    };
    return p;
  }

  it('T3.21 a provider error mid-round ends the run with a fixed message, never e.message', async () => {
    const leak = 'sk-test-FAKEFAKEFAKEFAKE1234';
    const p = failing([undefined, undefined, new ProviderError('network', `boom ${leak}`)]);
    const seen: CritiqueTurn[] = [];
    const r = await runCritique(p, scan, { onTurn: (_i, t) => seen.push(t) });
    expect(r.status).toBe('error');
    expect(p.calls).toHaveLength(3);
    expect(r.turns.map((t) => t.status)).toEqual(['done', 'done', 'error']);
    expect(r.turns[2]?.error).toBe(CRITIQUE_ERRORS.network);
    expect(r.error).toBe(CRITIQUE_ERRORS.network);
    expect(r.verdict).toBeNull();
    expect(JSON.stringify([r, seen])).not.toContain(leak);
    expect(JSON.stringify([r, seen])).not.toContain('boom');
  });

  it('T3.21 a reply cut off at the length limit stops the run with its own fixed text, no retry', async () => {
    const cut = new ProviderError('other', TRUNCATED_TEXT);
    const p = failing([undefined, cut, undefined]);
    const r = await runCritique(p, scan, { retryDelaysMs: [1, 1, 1] });
    expect(r.status).toBe('error');
    expect(p.calls).toHaveLength(2);
    expect(r.turns.map((t) => t.status)).toEqual(['done', 'error']);
    expect(r.turns[1]?.error).toBe(CRITIQUE_TRUNCATED);
    expect(r.turns[1]?.content).toBe('some ');
    expect(r.error).toBe(CRITIQUE_TRUNCATED);
    expect(r.verdict).toBeNull();
    // Only the constant itself: another 'other' error keeps the generic text.
    const q = failing([new ProviderError('other', `${TRUNCATED_TEXT} (x)`)]);
    expect((await runCritique(q, scan)).error).toBe(CRITIQUE_ERRORS.other);
  });

  it('T3.21 a cut-off summary is never parsed into a verdict, even when its text would parse', async () => {
    let n = 0;
    const p: LLMProvider = {
      ...numbered(),
      async *chat() {
        n++;
        if (n < 7) {
          yield `turn ${n} cites 16px.`;
          return;
        }
        yield 'Verdict: Solid base.\nWorks:\n- Accent #0d9488\nChange:\n- Raise muted';
        throw new ProviderError('other', TRUNCATED_TEXT);
      },
    };
    expect(parseVerdict('Verdict: Solid base.\nWorks:\n- Accent #0d9488')).not.toBeNull();
    const r = await runCritique(p, scan);
    expect(n).toBe(7);
    expect(r.status).toBe('error');
    expect(r.turns[6]).toMatchObject({
      kind: 'summary',
      status: 'error',
      error: CRITIQUE_TRUNCATED,
    });
    expect(r.verdict).toBeNull();
    expect(r.summaryText).toBeUndefined();
  });

  it('T3.21 a rate limit is retried after a backoff and the run continues', async () => {
    const p = failing([undefined, undefined, new ProviderError('rate', 'slow down')]);
    const seen: CritiqueTurn[] = [];
    const r = await runCritique(p, scan, {
      retryDelaysMs: [1, 1, 1],
      onTurn: (_i, t) => seen.push(t),
    });
    expect(r.status).toBe('done');
    expect(p.calls).toHaveLength(8); // 7 turns + 1 retry
    expect(r.turns).toHaveLength(7);
    expect(seen.some((t) => t.status === 'retrying' && t.retryInMs === 1)).toBe(true);
  });

  it('T3.21 a rate limit that outlasts every retry fails the run (at most 3 retries per turn)', async () => {
    const rate = new ProviderError('rate', 'slow down');
    const p = failing([undefined, rate, rate, rate, rate, undefined]);
    const r = await runCritique(p, scan, { retryDelaysMs: [1, 1, 1] });
    expect(r.status).toBe('error');
    expect(r.error).toBe(CRITIQUE_ERRORS.rate);
    expect(p.calls).toHaveLength(5); // turn 1 + turn 2 tried 4 times
  });

  it('T3.21 the default retry waits cover most of a minute and are capped', () => {
    expect(DEFAULT_RETRY_DELAYS_MS).toHaveLength(3);
    expect(DEFAULT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(90_000);
    expect(DEFAULT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(60_000);
  });

  it('T3.21 paceWait holds a call until enough of the last minute has expired', () => {
    expect(paceWait([], 4000, 8000, 60_000, 0)).toBe(0);
    expect(paceWait([{ at: 0, tokens: 3000 }], 4000, 8000, 60_000, 1000)).toBe(0);
    expect(paceWait([{ at: 0, tokens: 5000 }], 4000, 8000, 60_000, 10_000)).toBe(50_000);
    const two = [
      { at: 0, tokens: 3000 },
      { at: 20_000, tokens: 3000 },
    ];
    expect(paceWait(two, 4000, 8000, 60_000, 30_000)).toBe(30_000);
    // Entries older than the window no longer count.
    expect(paceWait([{ at: 0, tokens: 7000 }], 4000, 8000, 60_000, 61_000)).toBe(0);
  });

  it('T3.21 Groq is paced under its free-tier TPM: turns wait (shown) instead of failing', async () => {
    const groq = numbered({ id: 'groq' });
    expect(critiquePlan(groq, scan).tokensPerMinute).toBe(PROVIDER_TPM.groq);
    expect(critiquePlan(groq, scan).estMinutes).toBeGreaterThanOrEqual(2);
    expect(critiquePlan(numbered(), scan).tokensPerMinute).toBeNull();

    const seen: CritiqueTurn[] = [];
    const r = await runCritique(groq, scan, {
      tokensPerMinute: 1, // every call needs the window to itself
      paceWindowMs: 15,
      onTurn: (_i, t) => seen.push(t),
    });
    expect(r.status).toBe('done');
    expect(groq.calls).toHaveLength(7);
    expect(seen.filter((t) => t.status === 'waiting')).toHaveLength(6);
    expect(seen.find((t) => t.status === 'waiting')?.retryAt).toBeGreaterThan(0);
  });

  it('T3.21 Stop during a pacing wait stops with no further call', async () => {
    const ctl = new AbortController();
    const p = numbered();
    const r = await runCritique(p, scan, {
      signal: ctl.signal,
      tokensPerMinute: 1,
      paceWindowMs: 60_000,
      onTurn: (_i, t) => {
        if (t.status === 'waiting') ctl.abort();
      },
    });
    expect(r.status).toBe('stopped');
    expect(p.calls).toHaveLength(1);
    expect(r.turns[1]?.status).toBe('stopped');
  });

  /** Yields `before` chunks, then hangs until its signal aborts. */
  function hanging(before: string[]) {
    const calls: ChatRequest[] = [];
    const p: LLMProvider & { calls: ChatRequest[] } = {
      id: 'h',
      label: 'H',
      capabilities: { vision: false, streaming: true, contextTokens: 8192 },
      status: async () => ({ state: 'ready' }),
      calls,
      async *chat(req, signal) {
        calls.push(req);
        for (const c of before) yield c;
        if (!signal?.aborted) {
          await new Promise((res) => signal?.addEventListener('abort', res, { once: true }));
        }
        throw new ProviderError('aborted', 'Stopped');
      },
    };
    return p;
  }

  it('T3.21 a stalled stream (no first token, or a long gap) ends the run with a fixed message', async () => {
    for (const before of [[], ['some words']]) {
      const p = hanging(before);
      const r = await runCritique(p, scan, { stallMs: { first: 20, gap: 20 } });
      expect(r.status).toBe('error');
      expect(r.error).toBe(STALLED_ERROR);
      expect(r.turns[0]?.status).toBe('error');
      expect(p.calls).toHaveLength(1);
    }
  });

  it('T3.21 Stop while a stream hangs is a stop, not a stall', async () => {
    const ctl = new AbortController();
    const p = hanging(['x']);
    const r = await runCritique(p, scan, {
      signal: ctl.signal,
      stallMs: { first: 60_000, gap: 60_000 },
      onTurn: (_i, t) => {
        if (t.content) ctl.abort();
      },
    });
    expect(r.status).toBe('stopped');
    expect(r.turns[0]?.status).toBe('stopped');
  });

  it('T3.21 an empty reply is marked empty, left out of later prompts, and the run continues', async () => {
    let n = 0;
    const p = createMockProvider({
      respond: () => (++n === 1 ? '' : `turn ${n} at 16px.`),
      chunks: undefined,
    });
    const r = await runCritique(p, scan);
    expect(r.status).toBe('done');
    expect(r.turns[0]?.status).toBe('empty');
    expect(userMsg(p.calls[1])).not.toContain('[Brand designer]');
  });

  it('T3.21 Stop during the rate-limit backoff stops with no retry call', async () => {
    const ctl = new AbortController();
    const p = failing([new ProviderError('rate', 'slow down')]);
    const r = await runCritique(p, scan, {
      signal: ctl.signal,
      retryDelaysMs: [60_000],
      onTurn: (_i, t) => {
        if (t.status === 'retrying') ctl.abort();
      },
    });
    expect(r.status).toBe('stopped');
    expect(p.calls).toHaveLength(1);
    expect(r.turns[0]?.status).toBe('stopped');
  });

  it('T3.22 the brand filter runs on every turn and keeps the measured values', async () => {
    const p = createMockProvider({ text: 'Zentrix uses #1a2b3c at 16px.', chunkSize: 5 });
    const snaps: string[] = [];
    const r = await runCritique(p, scan, { onTurn: (_i, t) => snaps.push(t.content) });
    const streamed = snaps.filter(Boolean);
    expect(streamed.length).toBeGreaterThan(7);
    for (const text of [...streamed.slice(-1), ...r.turns.map((t) => t.content)]) {
      expect(text.toLowerCase()).not.toContain('zentrix');
    }
    expect(r.turns[0]?.content).toContain('#1a2b3c');
    expect(r.turns[0]?.content).toContain('16px');
    for (const s of streamed) expect(s.toLowerCase()).not.toMatch(/zentrix/);
    // The next request carries the sanitized text, not the raw brand.
    expect(userMsg(p.calls[1])).toContain('#1a2b3c at 16px');
    expect(userMsg(p.calls[1]).toLowerCase()).not.toContain('zentrix');
  });

  it('T3.22 a turn the filter empties is marked filtered and left out of later prompts', async () => {
    let n = 0;
    const p = createMockProvider({
      respond: () => (++n === 1 ? 'Zentrix' : `turn ${n} at 16px.`),
    });
    const r = await runCritique(p, scan);
    expect(r.turns[0]?.status).toBe('filtered');
    expect(r.turns[0]?.content).toBe('');
    expect(userMsg(p.calls[1])).not.toContain('[Brand designer]');
    expect(r.status).toBe('done');
  });

  it('T3.23 a human message queued during a turn reaches the next speaker without adding calls', async () => {
    const queue: string[] = [];
    const p = numbered();
    const long = `Focus on contrast please. ${'x'.repeat(2000)}`;
    const r = await runCritique(p, scan, {
      takeHuman: () => queue.splice(0),
      onTurn: (i, t) => {
        if (i === 0 && t.status === 'streaming' && t.content) queue.push(long);
      },
    });
    expect(p.calls).toHaveLength(7);
    expect(r.turns[1]).toMatchObject({ kind: 'human', status: 'done' });
    expect(r.turns[1]?.content).toHaveLength(1000);
    const next = userMsg(p.calls[1]);
    expect(next).toContain('[Human]: Focus on contrast please.');
    expect(next).toContain('First answer what the Human just said.');
    expect(userMsg(p.calls[2])).not.toContain('First answer what the Human');
  });

  it('T3.24 the transcript fits the context budget, keeping the newest turns and the latest Human', async () => {
    const queue = ['Prioritise mobile.'];
    const p = createMockProvider({
      contextTokens: 2048,
      text: `${'long words '.repeat(150)}16px.`,
    });
    await runCritique(p, scan, { takeHuman: () => queue.splice(0), rounds: 3 });
    expect(p.calls).toHaveLength(10);
    for (const c of p.calls) {
      const limit = Math.max(
        messageBudget(2048, c.system?.length ?? 0, c.maxTokens ?? 0),
        MESSAGE_FLOOR,
      );
      expect(userMsg(c).length).toBeLessThanOrEqual(limit);
      expect(userMsg(c)).toContain('[Human]: Prioritise mobile.');
    }
    const last = userMsg(p.calls[9]);
    expect(last).toContain('[earlier discussion omitted]');
    expect(last).toContain('Verdict:');
  });

  it('T3.28 the user goal reaches every call outside <page_data>, clipped, and never changes the system prompt', async () => {
    const goal = `A booking app for dentists.\u0007 We care about trust.${'x'.repeat(1500)}`;
    const p = numbered();
    const plain = numbered();
    await runCritique(p, scan, { context: goal });
    await runCritique(plain, scan);
    expect(p.calls).toHaveLength(7);
    for (const [i, c] of p.calls.entries()) {
      const msg = userMsg(c);
      expect(msg).toContain(
        "[Goal] (the user's own words, not page data): A booking app for dentists.",
      );
      expect(msg).not.toContain('\u0007');
      const goalText = msg.split('\n')[0] ?? '';
      expect(goalText.length).toBeLessThanOrEqual(MAX_CONTEXT + 60);
      // The goal is user text: never inside the page data, never in the cached system prefix.
      expect(c.system).not.toContain('booking app');
      expect(c.system).toBe(plain.calls[i]?.system);
    }
    expect(userMsg(plain.calls[0])).toContain('[Goal]: the user gave no goal');
  });

  it('T3.28 clipContext trims, strips control characters and clips to MAX_CONTEXT', () => {
    expect(clipContext('  hi\u0000 there\n ')).toBe('hi there');
    expect(clipContext('a\nb\tc')).toBe('a\nb\tc');
    expect(clipContext(undefined)).toBe('');
    expect(clipContext('y'.repeat(5000))).toHaveLength(MAX_CONTEXT);
  });

  it('T3.28 the goal survives budget trimming on a small context', async () => {
    const p = createMockProvider({
      contextTokens: 2048,
      text: `${'long words '.repeat(150)}16px.`,
    });
    const goal = 'g'.repeat(MAX_CONTEXT);
    await runCritique(p, scan, { context: goal, rounds: 3 });
    for (const c of p.calls) {
      const limit = Math.max(
        messageBudget(2048, c.system?.length ?? 0, c.maxTokens ?? 0),
        MESSAGE_FLOOR,
      );
      expect(userMsg(c)).toContain(goal);
      expect(userMsg(c).length).toBeLessThanOrEqual(limit);
    }
    expect(userMsg(p.calls[9])).toContain('[earlier discussion omitted]');
  });

  it('T3.29 parseVerdict reads lenient formats and rejects garbage', () => {
    expect(
      parseVerdict(
        '**Verdict:** Clean and calm.\n## What works\n* a #fff\n1. b 16px\n**Change:**\n- c\nDisagreements:\n- d',
      ),
    ).toEqual({
      verdict: 'Clean and calm.',
      works: ['a #fff', 'b 16px'],
      change: ['c'],
      disagreed: ['d'],
    });
    // The verdict on the line after its heading; "None" is an empty list.
    expect(
      parseVerdict('Verdict:\nGood.\nWorks: inline\nChange:\n- x\nDisagreed:\n- None'),
    ).toEqual({
      verdict: 'Good.',
      works: ['inline'],
      change: ['x'],
      disagreed: [],
    });
    // Prose that starts with a heading word is not a heading.
    expect(
      parseVerdict(
        'Verdict: ok\nWorks:\n- 4px grid\nWorks well overall.\nChange:\n- muted text\nChanges like this matter.\nChanges:\n- one more',
      ),
    ).toEqual({
      verdict: 'ok',
      works: ['4px grid'],
      change: ['muted text', 'one more'],
      disagreed: [],
    });
    expect(parseVerdict('Just some prose about the design.')).toBeNull();
    expect(parseVerdict('Works:\n- a\nChange:\n- b')).toBeNull();
    expect(parseVerdict('Verdict: fine\nWorks:\nChange:')).toBeNull();
    const many = `Verdict: v\nWorks:\n${'- k\n'.repeat(8)}Change:\n- c\nDisagreed:\n${'- d\n'.repeat(5)}`;
    expect(parseVerdict(many)?.works).toHaveLength(5);
    expect(parseVerdict(many)?.disagreed).toHaveLength(3);
  });

  it('T3.29 the verdict is parsed from sanitized text: the brand is gone, the measured values stay', async () => {
    const p = createMockProvider({
      respond: (req) =>
        String(req.messages[0]?.content).includes('Verdict:')
          ? 'Verdict: Zentrix is tidy.\nWorks:\n- Zentrix uses #1a2b3c at 16px\nChange:\n- Raise #999999 to 4.5:1\nDisagreed:\n- None'
          : 'turn cites 16px.',
    });
    const r = await runCritique(p, scan);
    expect(r.verdict).not.toBeNull();
    const all = JSON.stringify(r.verdict) + (r.summaryText ?? '');
    expect(all.toLowerCase()).not.toContain('zentrix');
    expect(r.verdict?.works[0]).toContain('#1a2b3c');
    expect(r.verdict?.works[0]).toContain('16px');
    expect(r.verdict?.change[0]).toContain('4.5:1');
  });

  it('T3.30 engine: a throwing onTurn never breaks a turn', async () => {
    const p = numbered();
    const r = await runCritique(p, scan, {
      onTurn: () => {
        throw new Error('Attempting to use a disconnected port object');
      },
    });
    expect(r.status).toBe('done');
    expect(p.calls).toHaveLength(7);
    expect(r.turns.every((t) => t.status === 'done')).toBe(true);
    expect(r.verdict).not.toBeNull();
  });
});
