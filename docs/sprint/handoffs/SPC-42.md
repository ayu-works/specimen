# SPC-42 handoff: Ask replays a stopped answer (L3); vibe JSON mode (L4)

## Plan (APPROVED by pe-b2, 2026-10-17; L3 only, L4 → SPC-54 per specimen-5c)

Stacked on `exec/spc-41` (PR #45). Sources: `docs/sprint/reviews/SPC-34-b-r1.md` L3, L4. No Linear comments.

### L3: a stopped Ask answer is marked in history and never replayed

**Today.** `Ask.tsx` `submit()`: on `kind === 'aborted'` nothing is set, so the partial bubble looks whole, is saved
without an `error`, and the history filter (`!m.error && m.content`) replays it next turn. A Stop before the first
delta also leaves an empty bubble that shows the "thinking …" mascot forever (and after a reload).

**Choice: mark, not drop.** On abort the bubble gets `error: STOPPED_TEXT` (`'Stopped.'`). The partial text stays
visible above it (same render as the SPC-34 cut-off case), it's persisted with that marker, and the existing history
filter already excludes any message with `error`, so it is never replayed, live or after a reload. Reusing the
existing `ChatMessage.error` field means no change to `lib/db.ts`, `chatScrub.ts` or the stored shape (no migration).
The stopped line renders muted (no sad mascot, not `text-destructive`): it's the user's own action, not a failure.
The renderer tells it apart by `m.error === STOPPED_TEXT`.

**History pairs.** While here: dropping an errored/stopped answer leaves its question in history, so the model sees
two user turns in a row (existing behaviour for errors too). I'll build history from complete pairs only: a user turn
is kept only if the next message is an assistant reply with content and no error. Small pure helper
`askHistory(messages)` in a new `sidepanel/askHistory.ts`, unit-tested (pe-b2: in scope).

**Files (mine):** `sidepanel/views/Ask.tsx`, new `sidepanel/askHistory.ts` (+ `askHistory.test.ts`),
`test/ask.test.tsx`, `docs/TESTING.md` (extend the T3.12 row, no new ID).

**Failure modes.**
- Stop races the last delta / normal end: `ask()` resolves → `setLast({content})`, no marker; it's a whole answer. If
  it rejects with `aborted`, it's marked. Either way one final state.
- Stop before any text: bubble shows "Stopped." with empty content instead of an endless "…"; excluded from history.
- Abort that surfaces as a non-`ProviderError` (`DOMException` AbortError): unchanged (shown as an error, also
  excluded). "Stopped" is decided by `controller.signal.aborted` (pe-b2), so both shapes get the marker.
- Panel closed mid-answer: `finally` never runs; whatever was last saved stays (existing; out of scope).
- Old transcripts saved before this fix hold stopped answers with no marker: they can't be told apart and stay in
  history. Accepted (stated in the PR).
- Persistence: `saveChat` in `finally` runs after the marker is set (same order as today's error path).

**Tests (T3.12, `test/ask.test.tsx`, fake provider only).**
1. Stop mid-stream: partial text plus "Stopped." shown; the next question's request contains neither the partial
   text nor its question; saved row has `error: 'Stopped.'`; after a reload it is still marked and still excluded.
2. Stop before the first delta: "Stopped." shown, no endless "…".
3. `askHistory` unit: whole pairs kept in order; errored, stopped, empty and trailing unanswered turns drop their pair.

### L4: out of this PR (orchestrator, 2026-10-17)
`llmHost.ts` belongs to open PR #42, so L4 is left out. Follow-up: **SPC-54** (after merge-all). See "Not done here".
`vibe.ts` now belongs to spc-46; this lane is Ask history only.

### Gate
`pnpm gate` green; PR base `exec/spc-41`. Owner manual steps: Ask → Stop mid-answer → "Stopped." shown, next answer
doesn't continue the half answer; reload the panel → still marked.

## Not done here (L4 → SPC-54, follow-up after merge-all)
Findings: `vibe.ts` already sends `json: true`. The BYOK adapters already map it (`openaiCompat` →
`response_format: {type:'json_object'}`, `gemini` → `responseMimeType: 'application/json'`; Anthropic has no JSON
mode). So no adapter change or SPC-46 seam is needed. The only gap is local Gemma.
- **Exact line:** in `apps/extension/src/entrypoints/offscreen/llmHost.ts` `runChat()`, inside the
  `engine.chat.completions.create({ ... })` argument, after `temperature: req.temperature,` add:
  `...(req.json ? { response_format: { type: 'json_object' as const } } : {}),`
  Keep the prompt suffix in `toMessages()`. WebLLM 0.2.85 grammar-constrains `json_object` (XGrammar), so Gemma
  stops when the object closes instead of rambling into `max_tokens` → `TRUNCATED_TEXT` (SPC-34 b-r1 L4).
- **Test idea:** in the llmHost tests' fake `@mlc-ai/web-llm`, record the whole `create()` body. (1) A
  `json: true` chat through `createWebLLMProvider` + the host gets `response_format: {type:'json_object'}`. (2) A
  chat without `json` (Ask/council) gets no `response_format`. Fake engine only, no GPU, no network.
- **Required by pe-b2 (2026-10-17):** if `create()` rejects before any delta while `response_format` is set (a
  `GrammarMatcherInitError`, or any error whose message mentions grammar or response_format), retry the same request
  once without `response_format` (the prompt suffix still asks for JSON). Tests: a grammar-init rejection retries once
  without `response_format` and succeeds; a non-grammar error is not retried.
- Owner manual step for SPC-54: "Vibe with local Gemma returns cleanly" (no CI runs real WebLLM).
- Not proposed: parsing a complete object out of a `TRUNCATED_TEXT` vibe reply (that reverses SPC-34's "cut-off
  text is never parsed", asserted in vibe.test.ts).

## Done
- L3 built: `sidepanel/askHistory.ts` (`askHistory`, `STOPPED_TEXT`), `views/Ask.tsx` (abort → `error: 'Stopped.'`
  by `ctl.signal.aborted`; muted "Stopped." line; history via `askHistory`), tests in `test/ask.test.tsx` (2 new)
  and `test/askHistory.test.ts` (3), T3.12 row extended. The new Ask tests fail against the old `Ask.tsx`.
- `pnpm gate` green 2026-10-17 (gitleaks skipped locally; CI scans).
- Lens A r1 (pe-b2): APPROVED, 0 findings.
- Lens B r1 folded (0C/0H/2M/2L, all fixed):
  - M1: what's in flight lives at module level (`inFlight` + `useSyncExternalStore`), so a remounted Ask shows Stop
    and blocks Send. `setLast` patches the index captured at submit, not "the last message".
  - M2: history keeps the question and replays a fixed stub (`STOPPED_STUB` / `NO_ANSWER_STUB`) instead of the half
    answer, so "shorter" / "try again" after a Stop or error still has context. This changes the plan's
    "drop the pair" rule, so pe-b2 checks it in the fold check.
  - L1: "…" shows only for the answer in flight. An empty reply gets `NO_ANSWER_TEXT`, and a saved empty answer with
    no error shows "No answer.".
  - L2: an `aborted` error the user didn't start shows "The answer was interrupted. Try again.".

## Next / resume
- Lens B r1 folded and pushed; waiting for pe-b2's fold check. L4 is SPC-54.
