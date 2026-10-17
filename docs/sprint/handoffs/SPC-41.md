# SPC-41 handoff: BYOK adapters reject a reply cut off at max tokens

## Plan (APPROVED by pe-b2, 2026-10-17)

**Problem.** #36 (SPC-34) made the local Gemma client throw `ProviderError('other', TRUNCATED_TEXT)` when a reply
stops at the token limit. The three BYOK adapters in `packages/ai/src/providers/` still end such a reply as if it
were complete, so the council can parse truncated JSON and Ask can store a cut-off answer as whole.

**Scope fact.** All three adapters are streaming only (`stream: true` / `:streamGenerateContent?alt=sse`); there is
no non-streaming path in `packages/ai`. So "streaming and non-streaming" reduces to the one SSE path per adapter.

**Approach.** Match the Gemma client (`webllm.ts:159`): every text delta is yielded first, then the generator throws
`new ProviderError('other', TRUNCATED_TEXT)`. Callers keep the partial text but never treat it as a whole reply.
The existing `TRUNCATED_TEXT` constant from `errors.ts` is reused; no new copy.
- **openaiCompat:** read `choices[0].finish_reason`. If it is `'length'`, yield that chunk's `delta.content` first
  (Groq, Ollama and others put the last text and the finish reason in the same chunk), then throw. A trailing
  `[DONE]` or usage chunk is never reached, which is fine.
- **anthropic:** on `message_delta` with `delta.stop_reason === 'max_tokens'`, throw (every `content_block_delta`
  comes before `message_delta`). `model_context_window_exceeded` (the output hit the context window) is the same cut
  off, so it is treated the same way. `end_turn` / `stop_sequence` / `tool_use` stay normal. The existing "no
  `message_stop` → 'The response was cut off. Try again.'" (a dropped connection) stays as it is.
- **gemini:** read `candidates[0].finishReason`. If it is `'MAX_TOKENS'`, yield that chunk's parts first, then throw.
  `STOP` (and absent) stays normal. Other finish reasons (SAFETY etc.) are out of scope and unchanged.

**Key safety (SPC-16).** The thrown message is the fixed constant; nothing from the event is copied into the message
or a `cause`. A `ProviderError` thrown inside the adapter's loop is not re-wrapped (it never passes `mapThrown`'s
catch in `postSse`, and `mapThrown` passes `ProviderError` through unchanged anyway).

**Callers (checked, no change needed).** All match on `err.message === TRUNCATED_TEXT` / the error, provider-agnostic:
`critique.ts:643` (council → `CRITIQUE_TRUNCATED`, no retry, no verdict), `polishPrompt` (keeps original with that
reason, T3.07), `ask()` (T3.08 / T3.12 shows partial text + cut-off line, kept out of history), `vibe`. No caller
files are edited.

**Files.** `packages/ai/src/providers/{openaiCompat,anthropic,gemini}.ts`, `providers.test.ts`,
`docs/TESTING.md` (append to rows T3.02, T3.03, T3.04), this handoff. Touches nothing another open PR owns.

**Tests first** (`providers.test.ts`, no network: `stubFetch` + `sseResponse`):
- T3.02 openaiCompat: a stream ending `finish_reason:'length'` (with text in the same chunk) yields all the text, then
  rejects `{kind:'other', message: TRUNCATED_TEXT}`; a `finish_reason:'stop'` stream resolves with the full text.
- T3.03 anthropic: `message_delta` `stop_reason:'max_tokens'` (then `message_stop`) yields the text, then rejects
  with `TRUNCATED_TEXT`; `model_context_window_exceeded` likewise; `end_turn` resolves normally.
- T3.04 gemini: last chunk `finishReason:'MAX_TOKENS'` with text yields all text, then rejects with `TRUNCATED_TEXT`;
  `finishReason:'STOP'` resolves normally.
- One parametrised check: the truncation error's message, string and JSON never contain the key (fits T3.05's rule).

**Failure modes.**
- *Misleading success* (the bug): covered per adapter above.
- *Partial text lost:* text in the same chunk as the finish reason is yielded before the throw (tested).
- *False positive:* a normal stop must not throw (tested per adapter); only the exact limit values trigger it.
- *Ordering/duplication:* the throw happens once; nothing is yielded after it (the generator ends).
- *Cleanup:* throwing inside `for await` calls `postSse`'s `return()`, whose `sseEvents` `finally` releases the
  reader and abort listener; same as the existing stream-error path. No new resources.
- *Concurrency/idempotency/atomicity/drift:* stateless per call; the only shared fact is `TRUNCATED_TEXT`, reused,
  not copied, so it can't drift from what callers match.
- *Abort:* unchanged (T3.06 stays green).

**Check.** `pnpm gate`.

PE notes folded in: (a) T3.02 also covers OpenAI's own shape, an empty-delta chunk with `finish_reason:'length'`
after the text; (b) Gemini's `MAX_TOKENS` is final: one throw, later chunks are not read; (c) the rule is now in the
`LLMProvider.chat` doc comment (`types.ts`) for every future adapter.

## Done
- Plan approved. Tests first (6 cut-off cases red, 3 normal stops green), then the three adapters; `packages/ai`
  193/193. TESTING.md rows T3.02–T3.04 extended. `pnpm gate`, then PR.

- PR #45 open. Lens A r1 (pe-b2): APPROVED, 0 findings (`docs/sprint/reviews/SPC-41-a-r1.md`).

- Lens B r1 (`docs/sprint/reviews/SPC-41-b-r1.md`): 1 HIGH, 1 MEDIUM, 4 LOW. Fold:
  - **H1** (fixed): the BYOK Settings Test button (maxTokens 32) treated a reasoning model that thinks up to the cap
    as broken. `Byok.tsx` `test()` now takes `TRUNCATED_TEXT` as "Works: connected"; every other error stays red.
    The orchestrator gave me Byok.tsx. The tests are in a new file, `apps/extension/test/byokTest.test.tsx` (Groq
    `length`, Gemini `MAX_TOKENS`, Anthropic `max_tokens` with no text → connected; a 401 is still an alert), because
    `options.test.tsx` belongs to #40. The T3.13 row is #40's too, so these cases are described in the T3.02 row.
  - **M1** (fixed): openaiCompat also treats Mistral's `model_length` as a cut-off (tested).
  - **L3** (fixed): negative cases added: OpenAI `tool_calls`/`content_filter`, Anthropic
    `stop_sequence`/`tool_use`/`refusal`, Gemini `SAFETY`/`RECITATION` end whole.
  - **L1, L2, L4** (skipped): the orchestrator is filing them as one follow-up ticket (outside the token-limit scope).

- CI: gitleaks flagged the dummy key `sk-test-…` in byokTest.test.tsx (fold commit 37da9be). Following the
  orchestrator, the branch was rewritten (fold commit 134b9b2, `KEY = 'test-key'`, no ignore entry); the owner
  force-pushed it (origin = 6c7ebba). CI is green (gate + video).
- PE fold check (pe-b2, 2ebfddd..6c7ebba): APPROVED. Lens A is done.

## Next
- Nothing for the executor. Wait for the owner's "merge all".
