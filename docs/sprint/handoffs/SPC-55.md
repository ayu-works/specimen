# SPC-55: Vibe fails on Groq openai/gpt-oss-20b ("The provider reported an error mid-response.")

Executor: spc-55-4b · Branch `exec/spc-55`, stacked on `exec/spc-46` (#54, itself on #45). PR base: `exec/spc-46`.

## Plan (APPROVED by pe-b2, 2026-10-17: v1, then v2 with the 3-call design and the required changes below)

**Cause (PE, on the ticket):** gpt-oss-20b is a text-only reasoning model. Vibe asks for JSON mode; Groq validates
JSON-mode output and, when streaming, reports a failure as an `{error: {code: "json_validate_failed"}}` chunk inside
the 200 stream. `streamError()` maps that to `MID_STREAM_TEXT` (kind `other`), and vibe has no retry for it.
Related: an image rejection that a router reports mid-stream also lands on `MID_STREAM_TEXT`, so vibe's text-only
retry (HTTP-400 `IMAGE_REJECTED_TEXT` only) never runs.

**Approach (pe-b2's pre-ruling + owner decision, relayed by specimen-5c):** only `packages/ai/src/features/vibe.ts`.
No `streamError()` / `errors.ts` change (owned by #52); no adapter change.
1. `run({ withImage, json, maxTokens })`: JSON mode and the cap become parameters.
2. First attempt as today: image if vision + screenshot, `json: true`, cap `min(10000, floor(ctx/4))`.
3. **Retries: each remedy used at most once, at most 3 calls in total (2 extra).** After a failed call, pick the
   remedy for its error; if that remedy is already used, or 3 calls are done, rethrow the error as is:
   - `TOO_LONG_TEXT` **or the generic "The provider rejected the request (HTTP 400)…" text** (pe-b2, required:
     Gemini 8k-output models reject `maxOutputTokens` 10000 in camelCase wording that misses TOO_LONG) (a 400 whose text matches `max_tokens`: a model whose max output is under 10k) → **smaller
     cap** `min(4096, floor(ctx/4))`, same image/JSON. Only if that is actually smaller than the current cap (when
     ctx/4 ≤ 4096 the prompt itself is too long, so no retry).
   - `IMAGE_REJECTED_TEXT` with an image sent → unchanged: text-only, JSON on.
   - `MID_STREAM_TEXT` → **JSON off**, and text-only if an image was sent.
   - anything else (Stop/abort, rate, auth, network, `TRUNCATED_TEXT`, filtered, cut short) → rethrow, no retry.
   All matches are `ProviderError` kind `other` with the exact fixed text. `usedImage` and the cap come from the
   call that produced the vibe.
   The remedies don't fold into one: the max_tokens 400 arrives before any output, so its retry keeps JSON (JSON
   isn't the problem there); a later mid-stream failure on the smaller cap then gets the JSON-off call as the 3rd and
   last. Alternative if pe-b2 prefers fewer calls: fold (any first-call failure in {too-long, mid-stream} → one
   retry with smaller cap + JSON off + text-only, max 2 calls), at the cost of dropping JSON/image when not needed.
4. JSON off is safe for parsing: the system prompts still ask for the JSON object, `extractJson` finds `{…}` in prose
   or a fenced block, and a prose reply falls back to the summary path (clamped, sanitized, fail-closed as today).
5. **Owner decision (replaces 5000):** output cap `min(10000, floor(contextTokens / 4))` (was 1200 in #54), with the
   `min(4096, ctx/4)` fallback above. Comment updated.
6. Key-echo rule: nothing from the provider's error is read except through the existing `ProviderError` (fixed
   texts); vibe never builds a message from provider text.

**Files:** `packages/ai/src/features/vibe.ts`, `packages/ai/src/features/vibe.test.ts`, `docs/TESTING.md` (extend the
T3.35 row: the vibe producer row #54 already extends; no new ID, so no clash with T3.37/T3.38 on other branches),
this handoff.

**Tests first (T3.35, in `vibe.test.ts`)**, driving the real `createOpenAICompat` with a stubbed `fetch` that returns
fake Groq SSE bodies (`sseResponse` from testUtils; no network). Each must fail on the current vibe.ts:
- a. Groq preset, gpt-oss-20b, vision off: a request with `response_format` gets
  `data: {"error":{"message":"Failed to validate JSON… sk-live-ECHO…","type":"invalid_request_error","code":"json_validate_failed"}}`;
  a request without it gets a normal reply → vibe resolves; 2 fetches; the 2nd body has no `response_format` and no
  image; `usedImage: false`.
- b. vision on + screenshot: the request with an image gets a mid-stream error chunk ("model does not support image
  input") → retried once text-only and JSON off; 2 fetches; `usedImage: false`; summary from the 2nd reply.
- c. both attempts error mid-stream → rejects with `MID_STREAM_TEXT` exactly; 2 fetches (never 3); the message
  contains none of the provider's text (the fake `sk-…` echo).
- d. no retry on `TRUNCATED_TEXT` (existing test kept), on a mid-stream rate-limit chunk (kind `rate`, 1 fetch), and on
  abort (signal aborted → `aborted`, 1 fetch).
- e. HTTP-400 image rejection path unchanged: retry is text-only with JSON still on (existing test + assert `json`).
- f. cap: contextTokens 1,000,000 → 10000; 32,000 → 8000; 4096 → 1024 (replaces the 1200 assertion).
- h. Groq-shaped 400 `{"error":{"message":"max_tokens must be less than or equal to 8192 …"}}` when the body's
  `max_tokens` > 4096 → vibe resolves; 2 fetches, 2nd `max_tokens` 4096, JSON still on.
- i. that 400 on every call → rejects `TOO_LONG_TEXT`, 2 fetches (fallback used once). With ctx 8192 (cap already
  2048 ≤ 4096) → 1 fetch, no retry.
- j. combined: 400 max_tokens → then a `json_validate_failed` chunk on the 4096 call → 3rd call JSON off, cap 4096,
  resolves; a 3rd failure is final (exactly 3 fetches, never 4). Image path: vision + image rejected (400) + mid-stream
  error → still at most 3 calls.
- g. JSON-off retry whose reply is prose / fenced JSON still yields a clamped, sanitized vibe (brand never shown).

**Failure modes**
- Partial failure: the first attempt may have streamed text before the error; `collect` throws, the partial text is
  discarded, the retry starts clean (no mixing of two replies).
- Idempotency / loops: at most 3 provider calls per `vibe()` (each remedy once); a failure with no unused remedy is
  final.
- `TOO_LONG_TEXT` is also what a too-long *prompt* gives; the smaller cap may fix that too (prompt + max_tokens over
  the context), and otherwise costs one quick 400.
- Abort during retry: the same `signal` goes to the retry; abort → `aborted`, no further call.
- Cost: extra calls only after a failed call (user's own key; ≤ 10000 output tokens each, usually ~100–2000).
- Misleading success: `usedImage` reflects the attempt that produced the vibe.
- Drift: the cap lives in one constant; TESTING.md row text updated to 5000 in the same PR.
- Not covered (say so in the PR): an HTTP-400 rejection of `response_format` before streaming (generic "rejected
  the request (HTTP 400)") is not retried; and `json_validate_failed` still shows the generic mid-stream text if the
  retry fails too. A fixed `json_validate_failed` text in `streamError()` would be a follow-up for #52's lane; not
  required for this fix.

**Check:** `pnpm gate` green. Owner manual test (PR body): Settings → Groq, model `openai/gpt-oss-20b`, run Vibe on
any scanned page → a vibe is shown (no "error mid-response").

## Done
- Plan approved by pe-b2 (v2: each remedy once, ≤ 3 calls; cap-down also on the generic 400; exact-3 test; o-series
  test; Gemini 400 test through `createGemini`; retry keeps system prompt + page data).
- Tests first: 10 new/changed T3.35 tests in `vibe.test.ts` fail on the old vibe.ts, pass on the new one.
- `vibe.ts`: `run(attempt)`, retry loop with `cappedDown` / `contentRetried`; cap `min(10000, ctx/4)`, fallback
  `min(4096, ctx/4)`. The generic-400 match is by the `httpError` text prefix (errors.ts isn't exported for it and is
  #52's lane); the Gemini test catches drift.
- `docs/TESTING.md` T3.35 row extended.

- Lens A r1 (pe-b2): APPROVED, 0 C/H/M, 1 LOW (HTTP_400_PREFIX copies httpError's text; guarded by the Gemini
  test; exporting a constant is a follow-up for errors.ts' lane). Rebased onto exec/spc-46 a877227.
- SPC-46 lens B M1 (handed to SPC-55, "1200 too small for Gemini 2.5 thinking"): covered by the 10000 cap; the
  1M-context test asserts 10000. Its L1 (whitespace runaway is longer with a bigger cap) is accepted: latency only,
  still ends as TRUNCATED.

- Lens B r1 (`SPC-55-b-r1.md`): 1 C, 2 M, 2 L.
  - **C1** (the 10000 cap is over Groq free tier's 8000 TPM → 413, mapped to "rate", not retried): **owner decision
    (via specimen-5c, 2026-10-17): keep 10000 everywhere, no Groq TPM clamp; accepted risk.** Free-tier Groq keys may
    get a 413 / "rate limited" on Vibe; follow-up **SPC-59** covers the error text. (A TPM-clamp fold with a test was
    drafted, then dropped on that decision; nothing of it is committed.)
  - **M1** (a retry inherits #44's 30 s gap timer, not 120 s): goes into #44 (SPC-40), not this PR.
  - **M2** (OpenRouter 402 for credit reserved against max_tokens): follow-up **SPC-59**.
  - **L1** (the generic-400 cap-down also fires on unrelated 400s, and a `response_format` 400 never gets JSON off):
    listed in the PR body, not folded (wrap-up mode, keep the PR small).
  - **L2** (a mid-stream retry can bill the first attempt too): listed in the PR body.

## Next / how to resume
- `pnpm gate`, commit, push, PR (base `exec/spc-46`), comment on SPC-55, message specimen-5c. Then fold reviews.
- Known, not this ticket: OpenAI o-series reject `max_tokens` (adapter fix filed separately by specimen-5c); a fixed
  `json_validate_failed` text in `streamError()` (#52's lane); an HTTP-400 `response_format` rejection is not retried
  with JSON off (only capped down once).
