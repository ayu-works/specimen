# SPC-30 lens B review, round 1

PR #52 (base `exec/spc-41`), reviewed at `4ba1fb2`. Reviewer: lens B (fresh), 2026-10-17.

**Count: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 4 LOW.** Approve after M1. The LOWs are optional.

## How it was checked
- Read `git diff exec/spc-41..HEAD`, the handoff plan, SPC-30 and its comments, and the critique retry loop
  (`critique.ts:620-648`), the council host (the provider runs in-process in offscreen, so `ProviderError`
  and the message compare survive), and Ask/Settings (they show `e.message`; only `aborted` is special-cased).
- Ran `vitest` on `errors.test.ts` and `critique.test.ts`: 70/70 pass.
- Probed `httpError`/`streamError` with a scratch script (tsx, fake `Response`s, no network) over real-world
  body shapes. **No real rate limit came out as out of credit:** OpenAI `rate_limit_exceeded`, Groq TPM
  (`type:"tokens"`), Azure (`code:"429"` string), Mistral (top-level `message`, `type:"rate_limited"`),
  Anthropic `rate_limit_error`, OpenRouter's free-model daily 429 ("…Add 10 credits to unlock…": the phrase
  regex does not match), Gemini `RESOURCE_EXHAUSTED` (both texts), an HTML 429 from a proxy, and an empty 429
  all stay `rate`/`RATE_TEXT`. DeepSeek 402, OpenRouter 402, Anthropic 400 and xAI 403 credit bodies give
  `OUT_OF_CREDIT_TEXT`.
- Key echo: the new branches only test body fields; the message is the constant. The leak test with a key
  in the body covers it.
- Tests vs old code: each new `httpError`/`streamError` case would fail on `exec/spc-41` (429 → rate,
  402 → "HTTP 402", Anthropic 400 → generic 400, xAI 403 → auth, stream `insufficient_quota` → mid-stream).
  The council test would fail on the old code because it expects `OUT_OF_CREDIT_TEXT`, not `CRITIQUE_ERRORS.other`.
- Pacing (`PROVIDER_TPM`) is proactive and does not look at errors, so out of credit doesn't change it.
  Retry only fires on `kind === 'rate'`, and out of credit is `'other'`, so it stops at once.

## MEDIUM

### M1. OpenAI's `billing_not_active` 429 is still treated as a rate limit
**Where:** `packages/ai/src/errors.ts` `CREDIT_CODE`.
**Scenario:** an OpenAI account with no active billing (a new account with no card, or one whose card was
removed or declined) gets
`429 {"error":{"message":"Your account is not active, please check your billing details on our website.","type":"billing_not_active","code":"billing_not_active"}}`
(the OpenAI SDKs raise it as `RateLimitError`). Probe result: `rate | The provider is rate-limiting…`.
The council shows "Waiting for the rate limit…" and retries 3 times (~80 s), then fails with the rate
text. The user is told to wait, when waiting will never help. That is exactly the bug this ticket fixes,
in its other OpenAI form.
**Fix:** `/^(?:insufficient_quota|billing_hard_limit_reached|billing_not_active)$/`. This is still a
billing-only code, so a real rate limit can't trigger it. Add it to the 429 code/type test and to the
`streamError` test. The fixed text ("Add credit or billing with the provider") already fits.

## LOW

### L1. A string `error` or a top-level `code` is not checked for the billing code
**Where:** `httpError`: `billing = creditCode(j.error)`.
**Scenario:** a `custom` preset pointing at an OpenAI-compatible proxy or gateway that flattens the error,
for example `429 {"error":"insufficient_quota"}` or `429 {"code":"insufficient_quota","message":"You exceeded your current quota"}`.
Both come out as `rate` in the probe (`CREDIT_TEXT` has no `quota` term, by design). The run retries for
~80 s and then says the provider is rate-limiting.
**Fix:** `billing = creditCode(j.error) || creditCode(j) || (typeof j.error === 'string' && CREDIT_CODE.test(j.error.trim()))`,
plus a test for each shape. This is still code-anchored, so Gemini's wording is not affected.

### L2. A mid-stream credit event with a numeric code gets the generic mid-stream text
**Where:** `streamError`.
**Scenario:** OpenRouter reports errors after the 200 as `{"error":{"code":<number>,"message":…}}`. A
`{"code":402,"message":"Insufficient credits"}` event maps to `MID_STREAM_TEXT` ("reported an error
mid-response"). It is not misread as a rate limit and is not retried, so the harm is only an unclear
message.
**Fix (optional):** in `streamError`, treat `e.code === 402 || e.status === 402` as out of credit, and add a test.

### L3. The council test does not start from a real provider body
**Where:** `critique.test.ts`, the new T3.21 case.
**Scenario:** the test injects `new ProviderError('other', OUT_OF_CREDIT_TEXT)` directly, so its "no
retry" assertion would also pass if `httpError` regressed to `'rate'` for `insufficient_quota`. That
regression would still be caught by the T3.05 `toMatchObject(OUT)` checks, so coverage holds, but only
indirectly.
**Fix (optional):** build the thrown error as `await httpError(new Response(<429 insufficient_quota body>, {status: 429}))`
in that test, so the 429 → council → no-retry path is driven end to end with a fake response.

### L4. The appended TESTING.md sentences run on with no full stop
**Where:** `docs/TESTING.md` rows T3.05 ("…stored text A 429 `insufficient_quota`…") and T3.21 (the same
pattern was inherited from SPC-41: "…marked `empty` A reply cut off…").
**Fix:** add ". " before each appended sentence. This is wording only and needs no re-review.

## Notes (pre-existing, out of scope, no action in this PR)
- OpenRouter's `402 "This request requires more credits, or fewer max_tokens…"` now reads as out of
  credit. That is acceptable, because the council's max_tokens are fixed, so adding credit is the user's
  real fix.
- An Anthropic **HTTP** 529 `overloaded_error` maps to "server error" and is not retried, while a
  **stream** 529 maps to `rate` and is retried. This inconsistency predates SPC-30 and could be a follow-up ticket.
- An OpenRouter 403 "Key limit exceeded" and a Gemini 403 "requires billing to be enabled" both still say
  "Invalid API key…". These are billing problems shown as auth. That is unchanged by this PR and could be
  a follow-up ticket if wanted.
