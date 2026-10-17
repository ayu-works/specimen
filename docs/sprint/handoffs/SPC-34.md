# SPC-34: local Gemma reply cut off by the token limit still reports `done`

Executor: spc-34-1f · Branch `exec/spc-34` (from origin/main de35272) · Lane C · Status: **BUILT, PR open, waiting for reviews (lens A + lens B)**

## PE ruling (pe-8a, 2026-10-17)
Approved, contract **A**, **no retry**. Notes folded in:
1. The council matches the `TRUNCATED_TEXT` constant on a `ProviderError` (identity of the message, not a regex).
2. `polishPrompt` is a consumer: test it falls back to the original with `reason === TRUNCATED_TEXT`
   (its catch already uses `e.message`; test 7 below).
3. Ask: a bubble with content and an error stays out of history **and** out of any persisted replay
   (stored via `saveChat`, reloaded via `loadChat`): test 6 covers both a live and a reloaded transcript.
4. ARCHITECTURE.md §"Port `llm`" lists the events: update to `done{id,truncated?}`.

## Problem
`runChat` in `apps/extension/src/entrypoints/offscreen/llmHost.ts` records `finish_reason` but only treats
`'abort'` specially; `'length'` falls through to `{type:'done'}`. The client (`WebLLMClient.chat`) returns
normally, so every consumer sees a complete reply:
- **Council** (`runTurn` in `packages/ai/src/features/critique.ts`): the turn ends `done`, the summary's
  cut-off text goes to `parseVerdict`, which can return a partial verdict (e.g. "Change:" list missing its tail,
  "Disagreed:" absent) shown as the real one. A cut-off persona turn is fed to later turns as if whole.
- **Vibe** (`json: true`): truncated JSON → `extractJson` usually null → generic failure, or worse a
  `{...}` that parses from a stray inner brace.
- **Ask**: a cut-off answer shows as a whole answer and is fed back as history.

## Contract proposal (PE ruling + owner OK needed before any code)
**Recommended (A): an optional flag on `done`, mapped to a fixed-text error in the client.**
```ts
// packages/ai/src/llmProtocol.ts (Offscreen -> client)
| { type: 'done'; id: string; /** The model stopped at maxTokens (finish_reason 'length'): the text is cut off. */ truncated?: true }

// packages/ai/src/errors.ts (new export, fixed text, same pattern as IMAGE_REJECTED_TEXT)
export const TRUNCATED_TEXT = 'The answer hit the length limit and was cut off.';
```
- Host: `finish === 'length'` (and not stopped) → `{type:'done', id, truncated: true}`. Precedence:
  stopped (`error aborted`) > `'abort'` (`error other`, unchanged) > `'length'` (`done truncated`) > `done`.
- Client `WebLLMClient.chat`: on `done` with `truncated` → `throw new ProviderError('other', TRUNCATED_TEXT)`
  **after** all deltas were yielded (callers keep the partial text they streamed).
- `LLMProvider` interface and `ProviderErrorKind` are **unchanged** (no new kind → no exhaustive
  `Record<ProviderErrorKind,…>` such as `CRITIQUE_ERRORS` to update, no other adapters touched).
- Why a flag on `done` rather than a new `error` event kind: the host states a fact ("ended at the length
  limit"), the client decides what it means; the wire stays additive (old shape still valid) and one place
  (the client) owns the user-facing text. Host and client ship in one extension, so there is no version skew.

Alternative (B), not recommended: add `'truncated'` to `ProviderErrorKind`. Cleaner type, but it changes the
shared `LLMProvider` contract for every adapter and every `Record<ProviderErrorKind,…>`; bigger blast radius
for one provider. Could be a later ticket if BYOK adapters get the same treatment (see Out of scope).

## Consumers
- **Council** (`critique.ts` `runTurn`): a thrown `ProviderError` whose message is `TRUNCATED_TEXT` →
  `fail(CRITIQUE_TRUNCATED)`, a new fixed message: *"A reply hit the length limit and was cut off, so the
  council stopped. Try again, or use fewer reviewers or rounds."* Turn `error`, run `error`, **no verdict**
  (`summaryText` only comes from a `done` summary). No retry: same request + same cap usually truncates
  again, and a local Gemma turn costs ~a minute; the user can re-run. (If the PE prefers one retry, it is
  a 3-line change in the same branch: reuse the `continue` path once.) Partial turn text stays visible
  (already the behaviour on errors: `turn.content = safe(raw)`).
- **Vibe**: no code change; `collect` throws → `vibe` rethrows the `ProviderError` (not the image-rejected
  text) → existing error UI shows `TRUNCATED_TEXT`. Test only.
- **Ask** (`Ask.tsx`): today an assistant message with `error` renders only the error. Change: when it has
  both content and error, render the content and then the error line under it ("…cut off"). The message
  keeps `error`, so it is still excluded from history (`!m.error && m.content`). Abort behaviour unchanged.
  This also shows partial text for other mid-stream errors, which I think is right (they were hidden).

## Files
- `packages/ai/src/llmProtocol.ts` (+1 optional field) · `packages/ai/src/errors.ts` (+`TRUNCATED_TEXT`)
- `packages/ai/src/providers/webllm.ts` (client: throw on `truncated`) · `packages/ai/src/index.ts` (export)
- `packages/ai/src/features/critique.ts` (`CRITIQUE_TRUNCATED`, map in `runTurn`)
- `apps/extension/src/entrypoints/offscreen/llmHost.ts` (send `truncated`); `attachLlmPort`, per-request abort,
  crash-during-load untouched.
- `apps/extension/src/entrypoints/sidepanel/views/Ask.tsx` (render content + error)
- `docs/ARCHITECTURE.md` Port `llm` row: `done{id,truncated?}`.
- `docs/TESTING.md` T3.07 / T3.11 / T3.21 / T3.12 rows: append the truncation clause (no new IDs).
- Tests listed below. No `site/` change.

## Tests (no real model; fake engine / mock provider)
1. `apps/extension/test/ai/llmHost.test.ts` T3.11: fake engine `Call.endLength` ends with
   `finish_reason:'length'` → `delta… done{truncated:true}`; a normal end has no `truncated`; a chat stopped
   by its own abort whose stream then ends `'length'` → `error aborted` (never done); next chat runs.
2. Same file, T3.11 **end to end** (the ticket's "how to check"): in-page Port (`createPortPair` +
   `attachLlmPort`) → `createWebLLMProvider({connect})` → `runCritique` with the fake engine truncating the
   summary → run `error`, summary turn `error` with `CRITIQUE_TRUNCATED`, `verdict` null, though the partial
   text would have parsed (it holds a "Verdict:" line + a "Change:" bullet).
3. `packages/ai/src/providers/webllm.test.ts` T3.11: `done{truncated}` → all deltas yielded, then rejects
   `ProviderError('other', TRUNCATED_TEXT)`; plain `done` still returns.
4. `packages/ai/src/features/critique.test.ts` T3.21: mock provider yields text then throws the truncated
   error on (a) a persona turn → run `error`, no later call, no summary; (b) the summary → `verdict` null.
   Message is `CRITIQUE_TRUNCATED`, never provider text. No retry (call count).
5. `packages/ai/src/features/vibe.test.ts`: truncated → rejects with `TRUNCATED_TEXT`, never parses.
6. `apps/extension/test/ask.test.tsx` T3.12: provider streams "partial" then throws truncated → the bubble
   shows "partial" and the cut-off line; the next question's history excludes it, also after the
   transcript is saved and reloaded (`saveChat`/`loadChat`).
7. `packages/ai/src/features/features.test.ts` T3.07: `polishPrompt` with a truncating provider → original
   text, `polished:false`, `reason === TRUNCATED_TEXT`.

## Failure modes
- **Stop vs length race:** the user's Stop lands as the model hits the limit → `stopped` wins (aborted), test 1.
- **`abort` from another job vs length:** unchanged precedence; `'abort'` stays an error.
- **Misleading success:** the core bug; tests 2/4 assert no verdict from a cut-off summary even when the
  partial text parses.
- **Partial text leaking unsanitized:** Ask/council already hold only sanitized snapshots; the throw happens
  after the last delta, so nothing new reaches the UI raw.
- **History drift:** a cut-off Ask answer keeps `error`, so it is not replayed as a complete assistant turn.
- **Atomicity / idempotency / cleanup:** no storage writes added; the council host stores the `error` record
  as today; the client's `finally` still removes listeners and disconnects the Port on the throw path.
- **Concurrency:** the flag is per job id; the queue/`running` handling is untouched; test 1 checks the next
  chat runs after a truncated one.
- **Drift between two copies of a fact:** one text constant (`TRUNCATED_TEXT`) used by client and tests; the
  council maps by identity of that constant, not a regex.

## Out of scope (follow-up suggestion)
BYOK adapters have the same gap (OpenAI-compatible `finish_reason:'length'`, Anthropic
`stop_reason:'max_tokens'`, Gemini `MAX_TOKENS`). They could throw the same `TRUNCATED_TEXT` later with no
further contract change; I'd suggest a ticket.

## Gate
`pnpm gate` green before the PR.

## Done / Next / How to resume
- Done (2026-10-17): plan approved by pe-8a (ruling A, no retry); the owner OK'd the contract (relayed by
  specimen-6a, recorded on Linear). Built as planned: `done.truncated?` in `llmProtocol.ts`, host sends it
  on `finish_reason 'length'` (stop and `'abort'` still win), the client throws `TRUNCATED_TEXT` after the
  deltas, the council fails with `CRITIQUE_TRUNCATED` (exact-constant match), Ask renders partial text + the
  error line (history filter unchanged). Tests 1–7 as listed (all red first except the stop-race guard,
  which already held). ARCHITECTURE Port row and TESTING T3.07/T3.11/T3.12/T3.21 updated.
  Rebased on origin/main 2bac238 (SPC-33's vibe.ts rework: the throw path is unchanged, vibe test still
  holds). `pnpm gate` green (gitleaks not installed locally: secrets skipped, CI scans).
- Side effect: Ask now also shows streamed text above *any* error (it was hidden before). That text was
  already the sanitized snapshot and is still stored and still excluded from history.
- Reviews r1: lens A (pe-8a) APPROVED, 0 findings. Lens B 0C/0H/1M/4L, contract matches.
  - **M1 folded:** `Council.tsx` `TurnBody` shows an error turn's partial text above its error (matches Ask;
    still no verdict: `Report` is gated on `done`). Test T3.33 (stored cut-off run → summary text + error, no
    `council-report`). This also corrects the plan's "stays visible" claim, which was not true before this fold.
  - **L1 folded:** `collect` sends one last full `safe(raw)` snapshot through `onText` before rethrowing (a guarded
    call that never masks the error), so a cut-off Ask answer isn't missing up to ~255 chars of a long line. Test
    T3.08. Not done: trimming a mid-word tail (the reviewer marked it optional; same weak case as the live stream).
  - **L2 (no change):** before the CWS release, do one manual local Gemma council run on a dense page; if the
    summary is cut off every time, open a ticket to tighten the local summary budget.
  - **L3 (follow-up ticket suggested):** a *stopped* Ask answer is still replayed as whole history (existing).
  - **L4 (no change):** Vibe now fails if Gemma rambles past a finished JSON object to 300 tokens; if seen,
    pass `response_format` for `json` requests or fall back in vibe (separate ticket).
- Next: fold check by the fresh PE; then wait for the owner's merge decision.
- Resume: `git log origin/main..exec/spc-34`; tests: `pnpm --filter ./apps/extension exec vitest run
  test/ai/llmHost.test.ts test/ask.test.tsx` (run `wxt prepare` first) and `pnpm -F @specimen/ai test`.
- Follow-up suggestion: same `TRUNCATED_TEXT` for the BYOK adapters (openaiCompat `length`, Anthropic
  `max_tokens`, Gemini `MAX_TOKENS`); no contract change needed.
