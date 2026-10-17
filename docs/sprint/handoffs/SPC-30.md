# SPC-30 handoff: out of credit is not a rate limit

Branch `exec/spc-30`, stacked on `exec/spc-41` (PR #45). PR base: `exec/spc-41`.

## Plan (APPROVED by pe-b2, 2026-10-17, all four decisions yes)

### Problem
`httpError` (packages/ai/src/errors.ts) maps every 429 to `kind: 'rate'`. OpenAI sends
`429 {"error":{"code":"insufficient_quota","type":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details…"}}`
when the account has no credit. The user is told to wait, and the council (critique.ts:629) retries
`kind === 'rate'` three times (~80 s) before failing with "still rate-limiting".

### Seam: no adapter change needed
`httpError` already reads and JSON-parses the body (it only keeps `error.message` today). I extend that
parse inside errors.ts to also read `error.code` and `error.type` (strings only). Every BYOK adapter
(openaiCompat, anthropic, gemini via `providers/http.ts`) and `listModels` already route a non-2xx through
`httpError`, so **no file in spc-46's lane is touched**. `streamError` (also errors.ts) gets the same check
for a mid-stream `{error:{code:"insufficient_quota"}}` event.

### No new error kind (no contract change)
Out of credit stays `kind: 'other'` with a new exported fixed text, the same pattern as `TRUNCATED_TEXT`
and `IMAGE_REJECTED_TEXT`:
```ts
export const OUT_OF_CREDIT_TEXT =
  'Your provider account is out of credit. Add credit or billing with the provider, then try again.';
```
- `ProviderErrorKind` (types.ts, `LLMProvider` contract, also in PR #45) is unchanged.
- Retry is avoided because the council only retries `'rate'`; `'other'` fails at once.
- Ask and the Settings Test button already show `e.message`, so they show the new text with no edit.
Alternative considered: a new `'quota'` kind. Rejected: it changes the shared contract, forces a new key in
`CRITIQUE_ERRORS` (a `Record` over the kinds) and any exhaustive switch, and needs a PE ruling + owner OK,
for no behaviour the fixed-text constant can't give.

### Classification (errors.ts, checked before the 429 → rate branch and before 401/403 → auth)
Out of credit when **any** of:
1. `code` or `type` is `insufficient_quota` (OpenAI, and hosts that copy its error shape), or
   `billing_hard_limit_reached` (OpenAI's spend cap). These codes are only ever used for billing.
2. HTTP **402** (DeepSeek "Insufficient Balance", OpenRouter "Insufficient credits", Together/xAI payment
   required). 402 has no other meaning for these APIs.
3. Status 400/403/429 **and** the message matches a narrow credit phrase:
   `/credit balance is too low|insufficient (?:balance|credits?|funds)|(?:out of|no) credits?|doesn't have any credits|billing hard limit/i`
   (Anthropic sends 400 "Your credit balance is too low to access the Anthropic API"; xAI sends 403
   "…doesn't have any credits…").

Deliberately **not** matched: the message "You exceeded your current quota" alone, and Gemini's
`429 RESOURCE_EXHAUSTED`. Gemini's free-tier per-minute limit uses that exact OpenAI wording, so it must stay
a rate limit (retrying it is right). Classification of OpenAI rests on the `code`/`type` field, not the text.
A plain 429 (`rate_limit_exceeded` or no body) stays `rate` with `RATE_TEXT`.

### Council (needs PE OK: packages/ai/src/features/critique.ts, no open PR owns it)
Without an edit the council already does not retry, but shows the generic `CRITIQUE_ERRORS.other`
("The provider returned an error. Try again…"), which is misleading. Proposed 1-line add next to the
truncated check at critique.ts:643:
```ts
if (err.message === OUT_OF_CREDIT_TEXT) return fail(OUT_OF_CREDIT_TEXT);
```
(The text is fixed and ours, so it is safe to show; it needs no council-specific wording.) If pe-b2 would
rather I not touch critique.ts, I drop this and only add the council test proving no retry.

### Files
- `packages/ai/src/errors.ts`: parse `code`/`type`, `OUT_OF_CREDIT_TEXT`, classification in `httpError` and `streamError`.
- `packages/ai/src/index.ts`: export `OUT_OF_CREDIT_TEXT` (one line; nobody else's lane).
- `packages/ai/src/errors.test.ts`: tests below.
- `packages/ai/src/features/critique.ts` + `critique.test.ts`: the one line above + one test (if approved).
- `docs/TESTING.md`: append to the T3.05 row ("429 `insufficient_quota`, 402 and credit-balance bodies →
  out-of-credit fixed text, kind `other`; a plain 429 and Gemini `RESOURCE_EXHAUSTED` stay rate (SPC-30)")
  and the T3.21 row ("out of credit stops at once with its own text, no retry"). PE owns IDs: OK to append?

### Tests (written first; fake `Response`s / stubbed fetch only, no network)
T3.05 in errors.test.ts:
- 429 `{error:{code:'insufficient_quota',type:'insufficient_quota',message:'You exceeded your current quota…'}}`
  → `{kind:'other', message: OUT_OF_CREDIT_TEXT}`; same with only `type` set; same with only `code`.
- 402 with any body, and 402 with an unreadable body → out of credit.
- 400 Anthropic "Your credit balance is too low…" → out of credit (not the generic 400 text, not auth).
- 403 xAI "…doesn't have any credits…" → out of credit (not auth); 403 "permission denied" stays auth.
- Negatives: plain 429 (no body; `rate_limit_exceeded`) → `rate`/`RATE_TEXT`; Gemini 429
  `{error:{code:429,status:'RESOURCE_EXHAUSTED',message:'You exceeded your current quota…'}}` → `rate`;
  400 "max_tokens… quota" style text unrelated to credit unchanged; a non-string `code` (number) ignored.
- Fixed text: message never contains body text (reuse the existing key-leak helper with a key in the body).
- Through a real adapter path: `openaiCompat.chat` with stubbed fetch returning the 429 insufficient_quota
  body → rejects with OUT_OF_CREDIT_TEXT (adapter itself unchanged; test sits in errors.test.ts, not providers.test.ts).
- `streamError({code:'insufficient_quota'})` → out of credit; `streamError({type:'rate_limit_exceeded'})` still rate.
T3.21 in critique.test.ts: a provider that throws `ProviderError('other', OUT_OF_CREDIT_TEXT)` is called
**once** (no retry, no `retrying` status emitted), the turn and run error are `OUT_OF_CREDIT_TEXT`; with
`retryDelaysMs` set so a retry would be visible.

### Failure modes
- **Misclassifying a real rate limit as out of credit** (worst: the user stops when waiting would work):
  guarded by matching OpenAI on `code`/`type` only and the Gemini negative test.
- **Misclassifying out of credit as auth** (403 xAI): credit check runs before the 401/403 branch, phrase is narrow.
- **Body unreadable / not JSON / huge:** existing try/catch; detail stays capped at 500 chars; `code`/`type`
  read only when strings. 402 alone still classifies.
- **Key echo:** text is fixed; body fields are only tested, never copied (existing T3.05 leak tests cover it).
- **Drift between two copies of a fact:** the council compares by the exported constant, never a copy of the string.
- **Stored chats:** old chats keep their old "rate-limiting" text; no migration needed (text only).
- Atomicity/idempotency/concurrency/cleanup: n/a (pure mapping function, no state).

### Check
`pnpm gate` green. Owner manual test: none needed beyond the unit tests (needs a zero-credit key); I'll list an
optional one in the PR body.

## Done
- Plan approved by pe-b2 with notes: Gemini per-day RESOURCE_EXHAUSTED stays rate (tested); an exact-text
  assertion so the Settings Test shows it as an error (tested); tests fail if the credit check moves after
  the auth or rate branch (xAI 403 and OpenAI 429 cases).
- Tests first (red: 8 failing), then errors.ts, index.ts exports (`OUT_OF_CREDIT_TEXT`, `RATE_TEXT`), the critique.ts
  line, and the T3.05/T3.21 rows in TESTING.md.
- `pnpm gate`: secrets skipped locally (no gitleaks; CI scans); typecheck, lint, test, build green; e2e had one
  timeout in T5.03 (mobile capture window, unrelated, busy machine) and passed 54/54 on rerun; check-ids green.

- PR #52 open (base exec/spc-41). Lens A r1 (pe-b2): APPROVED, 0 findings (docs/sprint/reviews/SPC-30-a-r1.md).
- Lens B r1 (docs/sprint/reviews/SPC-30-b-r1.md): 0C 0H 1M 4L, all folded. M1 `billing_not_active` added to
  CREDIT_CODE; L1 a flattened `{error:"insufficient_quota"}` or top-level `code` is checked; L2 a numeric 402
  mid-stream code is out of credit; L3 the council test starts from a real 429 body via httpError; L4 full stops
  in the TESTING.md rows. Gate green on the whole run (secrets skipped locally, no gitleaks).
- Out of scope (lens B notes, follow-up candidates): Anthropic HTTP 529 vs stream 529 retry mismatch;
  OpenRouter 403 "Key limit exceeded" and Gemini 403 "requires billing" shown as invalid key; mid-stream image
  rejection still MID_STREAM_TEXT (pe-b2 note).

## Next
- pe-b2 fold check. No merge without the owner (run mode: one final "merge all").

## How to resume
Read this file, then `git log exec/spc-41..exec/spc-30`.
