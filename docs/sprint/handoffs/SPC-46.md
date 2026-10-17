# SPC-46 handoff: BYOK stream end with no stop reason, filter stops, vibe budget

Executor: spc-46-89 · Branch `exec/spc-46`, stacked on `exec/spc-41` (PR #45) · PE: pe-b2 · Orchestrator: specimen-5c

## Plan (APPROVED by pe-b2, 2026-10-17: no new kind; MID_STREAM row included; vibe.ts in this lane)

Source: SPC-41 lens B r1 (`docs/sprint/reviews/SPC-41-b-r1.md`) L1, L2, L4. SPC-41's contract stays as it is: a
token-limit cut throws `ProviderError('other', TRUNCATED_TEXT)` after the partial text, and nothing here changes it.

### Contract proposal (PE ruling needed)
- **No new `ProviderErrorKind` and no new field.** Both new cases use the existing `'other'` kind with fixed text, so
  `types.ts` and `errors.ts` (spc-30's lane) are untouched. Callers that switch on `kind` (critique, polish, Ask)
  already treat `'other'` as a failure that keeps the partial text.
- Two fixed messages, exported from `packages/ai/src/providers/http.ts` (my lane; not re-exported from `index.ts`,
  since no caller needs to match them yet):
  - `CUT_SHORT_TEXT = 'The response was cut off. Try again.'`: the text Anthropic already throws inline when
    `message_stop` never arrives (hoisted, same string, so no UI drift).
  - `FILTERED_TEXT = "The provider's content filter stopped this answer."`: new.
- Neither message copies anything from the event (SPC-16 key-safety rule): no `cause`, no reason string.
- Distinct from `TRUNCATED_TEXT` on purpose: the council maps `TRUNCATED_TEXT` to "hit the length limit…", which
  would be wrong for a dropped connection or a filter.

### L1: a stream that ends with no stop reason → `CUT_SHORT_TEXT`
A stream is whole only when the provider said it finished. After the loop, each adapter throws
`ProviderError('other', CUT_SHORT_TEXT)` (after the partial text was yielded) unless:
- **openaiCompat:** it saw `data: [DONE]` **or** any non-null `finish_reason` (a local server that sends
  `finish_reason:"stop"` and closes without `[DONE]` is still whole; one that sends `[DONE]` with no
  `finish_reason`, like some llama.cpp/LM Studio builds, is still whole).
- **gemini:** it saw any `finishReason` string (Gemini always sends one on the last chunk).
- **anthropic:** unchanged, `message_stop` (now uses the shared constant).

Behaviour change: the existing test "T3.02 events with no text (and no [DONE]) still end quietly, as an empty
answer" flips to rejecting with `CUT_SHORT_TEXT`. That was the bug in L1.

### L2: a filter stop → `FILTERED_TEXT`; a provider-side error stop → `MID_STREAM_TEXT`
Exact-value sets per adapter, checked on the same chunk after its text is yielded (same ordering as SPC-41), one throw:
| Adapter | → `FILTERED_TEXT` | → `MID_STREAM_TEXT` (existing) |
|---|---|---|
| openaiCompat `finish_reason` | `content_filter` (OpenAI, Azure) | `error` (Mistral), `insufficient_system_resource` (DeepSeek) |
| gemini `finishReason` | `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `IMAGE_SAFETY`; and a chunk with `promptFeedback.blockReason` (prompt blocked, no candidates) | none |
| anthropic `stop_reason` | `refusal` (streaming classifier stop) | none |

Everything else keeps today's behaviour (`stop`, `tool_calls`, `end_turn`, `stop_sequence`, `tool_use`,
`pause_turn`, `STOP`, `OTHER`, `LANGUAGE`, unknown values). I'm not widening to "anything but STOP is an error":
an unknown future value would turn into a false failure. The MID_STREAM row is from lens B's L2 text; drop it if
you want the ticket kept to filters only.

### L4: vibe `maxTokens` vs Gemini 2.5 thinking
Recommend raising vibe's cap from 300 to `min(1200, floor(contextTokens / 4))`, the same rule critique's
`turnMaxTokens` uses ("generous for reasoning models"). It is provider-agnostic, so it also covers Groq's gpt-oss
and xAI's grok-3-mini, which have the same problem. `maxTokens` is a cap, not a target: the visible vibe reply is
~100 tokens, so cost is unchanged for non-thinking models. Gemma (4k context) gets 1000; page data for 4k is ~6.5k
chars ≈ 2k tokens, plus system, so it still fits.
- Rejected: setting `thinkingConfig.thinkingBudget` in the Gemini adapter. `ChatRequest` has no field for it (a
  contract change), the rule differs per model (2.5-pro can't go to 0, Gemini 3 uses `thinkingLevel`), and I can't
  check it without a real call.
- **Lane:** `packages/ai/src/features/vibe.ts` (+ `vibe.test.ts`) is mine (specimen-5c, 2026-10-17: SPC-42's vibe
  part moved to SPC-54, llmHost).

### Files
`packages/ai/src/providers/{http,openaiCompat,gemini,anthropic}.ts`, `providers.test.ts`;
`packages/ai/src/features/vibe.ts`, `vibe.test.ts` (if confirmed); `docs/TESTING.md` rows T3.02, T3.03, T3.04,
T3.35 only (append "SPC-46" text; no new IDs).

### Tests (written first; `sseResponse` + `vi.stubGlobal('fetch')` only, no network)
- **L1, per adapter:** text then a clean EOF with no finish → partial text yielded, then `CUT_SHORT_TEXT`, kind
  `other`, no `cause`, key absent from message/String/JSON/stack. Negative: openaiCompat `[DONE]` with no
  `finish_reason` is whole; `finish_reason:"stop"` with no `[DONE]` is whole; Gemini `STOP` is whole (existing).
  No-text events with no finish now reject (the flipped test).
- **L2, table-driven like SPC-41's `cut[]`:** each value in the table above → its text after the partial text, one
  throw, later chunks ignored. Gemini `promptFeedback.blockReason` with no candidates → `FILTERED_TEXT`.
  `content_filter`, `refusal`, `SAFETY`, `RECITATION` move out of `whole[]`; `tool_calls`, `stop_sequence`,
  `tool_use`, and Gemini `OTHER` stay as negatives. All throws pass the same key-safety check as `expectTruncated`.
- **SPC-41 kept:** the `cut[]` and remaining `whole[]` cases pass unchanged.
- **L4:** vibe sends `maxTokens` 1200 to a 1M-context provider and 1000 to a 4k-context provider; existing
  T3.35/cut-off tests unchanged.

### Failure modes
- **Ordering / partial text:** the chunk's text is yielded before any throw, and nothing is read after it, so the
  caller (`collect`, critique) keeps the whole partial text. Tested with text in the same chunk as the stop.
- **False failure (misleading error):** a local OpenAI-compatible server that omits one of `[DONE]` / `finish_reason`
  must stay whole; covered by both negative tests. A server that omits both was already ambiguous; it now reports
  "cut off", which is the honest answer.
- **Abort:** an aborted stream still rejects as `aborted` (postSse maps it before the loop ends), so the new
  after-loop throw never fires on Stop. Existing T3.06 tests cover it.
- **Key safety:** fixed strings only; the finish reason and the event body are never copied.
- **Drift between copies:** the three adapters keep their own value sets (they're different vocabularies), but the
  texts come from one place (`http.ts`). TESTING.md rows are updated in the same PR.
- **Callers:** critique maps `'other'` to its generic "The provider returned an error…" line and keeps the partial
  turn text; it won't show the filter wording. Changing that is `critique.ts`, outside this lane: I'll note it as a
  follow-up, not change it. Byok Test: a filter stop shows `FILTERED_TEXT` as an error (correct); a no-finish stream
  after text never reaches the throw (Test aborts on the first delta).
- Atomicity, idempotency, concurrency: n/a (pure stream parsing, no state).

## Done
- Tests first (failed as expected), then code. Built as planned, with two small changes:
  - Gemini and openaiCompat keep reading after a normal finish (a flag, not an early `return`), so no trailing text is dropped.
  - The vibe cap for a 4k context is 1024 (`floor(4096 / 4)`), not the "1000" the plan rounded to.
- The T3.04 header test's fake Gemini stream had no `finishReason` (a real one always has one), so `"finishReason":"STOP"` was added to its last chunk.
- `docs/TESTING.md` T3.02, T3.03, T3.04 and T3.35 rows extended.
- Not done: the optional Byok Test assertion (PE note b). `apps/extension/test/byokTest.test.tsx` is outside this lane, and
  Test aborts on the first delta, so only a no-text stream with no finish is affected (it now shows "cut off", which is honest).
- Follow-ups (not in this lane): critique.ts maps `'other'` to its generic line, so the council won't show the filter wording.
  `FILTERED_TEXT` / `CUT_SHORT_TEXT` could move to `errors.ts` and be exported once a caller needs to match them.

- `pnpm gate` green (secrets skipped locally: no gitleaks). PR #54 (base `exec/spc-41`), rebased on 81b4386; link on SPC-46.

- Lens A r1 (pe-b2): APPROVED, 0 C/H/M, 1 LOW (4k Gemma vibe cap 1024 is tight). Folded as an owner manual step in the
  PR body (no code change, no re-review needed).

- Lens B r1 (0 C/0 H/2 M/4 L), folded:
  - **M1** (the vibe cap of 1200 is small for Gemini 2.5 Pro thinking): not changed here. SPC-55 (stacked on this branch) raises it to
    `min(5000, ctx/4)` (owner decision, via specimen-5c), so vibe.ts stays as lens A approved it.
  - **M2** (the owner's MID_STREAM vibe error; a router's in-stream 400 doesn't trigger the text-only retry): out of scope, as the
    reviewer says. The fix is in `errors.ts` `streamError` (SPC-30's lane) or `vibe.ts` (SPC-55): **follow-up**.
  - **L2** fixed: openaiCompat skips `finish_reason: ""` (LocalAI), so it isn't taken as a finish; tests cover `""`→EOF (cut off) and `""`→`stop` (whole).
  - **L3** fixed: added whole-reply negatives for a usage-only chunk (`choices: []`) after `stop`, both before `[DONE]` and
    before a clean EOF, plus an OpenRouter `: PROCESSING` comment.
  - **L1** (a JSON whitespace runaway is longer with a bigger cap): no fix; it costs latency only and still ends as TRUNCATED. Belongs with SPC-55's cap.
  - **L4** (council/Ask show the generic line for a filter stop or a cut-short stream): **follow-up**, already listed (critique.ts + exporting the constants).
  - Pre-existing note (an OpenAI reasoning model's `max_tokens` 400 maps to TOO_LONG_TEXT): **follow-up** ticket, not #54.

## Next
- pe-b2 fold check.

## How to resume
Read this file, `gh pr diff 45`, and `docs/sprint/reviews/SPC-41-b-r1.md` (L1/L2/L4).
