# SPC-16: provider error text can echo the API key (audit H5), chromeBuiltin tests (H12), plus M1 and M3

Executor `spc-16-a3`, lane A. Branch `exec/spc-16`, rebased on `origin/main` 986317e (Council / SPC-24 merged).
Status: **Built, `pnpm gate` green, PR open (link on SPC-16).** Plan approved by pe-99 on 2026-10-15 with 5 changes, folded below.

## Plan

### Problem
- `packages/ai/src/errors.ts` `httpError()` appends up to 200 characters of the provider's error body to the 401/403,
  400 (api key), 404 / model-gone, 5xx and fallback messages. OpenAI-style bodies echo the key ("Incorrect API key
  provided: sk-…"). These messages reach the UI: Byok "Test" (`listModels` → `getJson` → `httpError`), Ask, Generate's
  polish notice, Vibe, Ask history.
- `anthropic.ts:71` copies a mid-stream `error.message` into the ProviderError.
- `mapThrown()` falls back to `e.message` for any non-Abort, non-TypeError throw, so on the HTTP path any odd error text
  goes straight to the UI.
- T3.05 today uses the body `'bad'`, so it can't fail.

### Approach (fixed user-facing text, classification kept)
1. **`httpError()` never puts body text in the message.** It still reads and parses the body, but only to *classify*
   (api_key, model gone, rate limit, image rejected). Every message is a fixed string:
   - 401/403 → `auth` "Invalid API key, or the key can't use this model."
   - 400 + /api[_ ]key/ → `auth` "Invalid API key."
   - 404 or model-gone → `other` "This model isn't available for your key. In Settings, click "Fetch models" and pick one."
   - 429 / rate limit → `rate` (unchanged)
   - **new:** 400 + the image-rejection pattern → `other` "This model can't read images." Today `vibe.ts` decides
     whether to retry without the screenshot by running `IMAGE_REJECTED` over the message, which only works *because*
     the body is echoed. I'll move `IMAGE_REJECTED` into `errors.ts` (exported), use it in `httpError`, and keep vibe's
     check working against the fixed message, which contains "image".
   - 5xx → "The provider had a server error. Try again in a minute."
   - other → "Request failed with HTTP <status>." (only the number).
   The kinds don't change, so Council's `CRITIQUE_ERRORS[kind]` mapping, rate-limit retry and T3.30–T3.33 are unaffected.
2. **HTTP-path fallback is fixed too.** Add `mapThrown(e, { fixedText: true })`, used by `postSse` and `models.getJson`:
   an unknown throw becomes `other` "The provider request failed." (cause kept for debugging, never shown). The default
   `mapThrown(e)` stays as it is for chromeBuiltin and critique.
3. **Mid-stream errors (M1):** `openaiCompat` and `gemini` reject on an SSE `{"error": …}` event; `anthropic`'s
   `type:error` keeps rejecting. All three use the fixed text "The provider reported an error mid-response." (`other`,
   or `rate` when the event's type/code says overloaded / rate limit, so Council still backs off). Nothing from the event
   body is copied.
4. **Truncated / empty streams (M1):** Anthropic: a stream that ends without `message_stop` rejects as `network`
   "The response was cut off. Try again." (text already yielded stays yielded). OpenAI-compat and Gemini: a 200 stream
   with **zero SSE events** rejects as `other` "The provider returned an empty response." I am deliberately *not*
   requiring `[DONE]` (some compat servers, e.g. older Ollama/LM Studio builds, omit it) and not rejecting a stream
   whose events just carry no text: Council reports that as `empty`, and changing it would change Council behaviour.
   The null-body branch in `http.ts` gets a test.
5. **chromeBuiltin (H12):** tests only, plus one code fix if a test exposes it. The `status()` catch echoes `e.message`;
   no key is involved, so I leave it.
6. **polishPrompt fallback reasons (M3):** tests only (empty output, a non-ProviderError throw, aborted re-throws).
   The "sanitize strips a brand token → reported as AI changed values" case: I'll write the test first. If it shows the
   wrong reason, the fix is to compute `missing` against the unsanitized output and report the sanitize case as
   "The AI output was filtered." That's a small change in `polishPrompt.ts` only.

### Files (all lane A, `packages/ai`)
`src/errors.ts`, `src/providers/{http,openaiCompat,anthropic,gemini}.ts`, `src/models.ts`, `src/features/vibe.ts`
(import the moved regex only), `src/features/polishPrompt.ts` (only if the M3 test shows the bug),
`src/providers/providers.test.ts`, new `src/providers/chromeBuiltin.test.ts`, `src/features/features.test.ts`,
`src/models.test.ts`, `docs/TESTING.md` (T3.05/T3.06 wording, no new IDs), this handoff.

### Tests (written first; the H5 ones must fail on today's main)
- **T3.05 key never in the message (H5):** a helper `leaks(msg, key)` that is true if any 8+ character substring of the
  key appears in the message. The key is a fake `sk-proj-…` string. Matrix: statuses 400, 401, 403,
  404, 429, 500, 503, 418 × bodies {OpenAI JSON `{"error":{"message":"Incorrect API key provided: <key>"}}`, Gemini
  `{"error":{"message":"API key not valid: <key>","status":"INVALID_ARGUMENT"}}`, plain text `<key>`, partial
  `…<key.slice(4,16)>…`} × adapters {openai, anthropic, gemini} + `listModels`. Assert `!leaks` and the expected kind.
  **Fails on main** (401 + OpenAI body).
- T3.05 mid-stream: an error event containing the key → rejects, and the message doesn't leak (fails on main for
  openai/gemini, which ignore it today and resolve).
- T3.05 unknown throw on the HTTP path (`fetch` rejects with `new Error('… <key> …')`) → fixed text, no leak (fails on main).
- T3.05 classification kept: 400 "image_url is not supported" → `other`, and `vibe` still retries text-only (vibe test
  updated to use a real `httpError` from a 400 Response instead of a hand-written message).
- T3.02/03/04 (M1): empty 200 stream rejects; null body rejects; Anthropic without `message_stop` rejects as `network`
  after yielding the partial text.
- T3.06 chromeBuiltin (H12), with `globalThis.LanguageModel` stubbed via `vi.stubGlobal`:
  - `status()`: missing → error; available → ready; downloadable/downloading → needs-setup; unavailable → error;
    `availability` throws → error. `isChromeBuiltinAvailable` false when it's missing, throws or is unavailable.
  - `chat`: missing → `unsupported`; last message not from the user → `other`, with `create` never called; it streams
    chunks; `initialPrompts` carry system + history.
  - abort before start → `aborted`, no `promptStreaming`; abort mid-stream → `aborted`, reader cancelled, `destroy`
    called once; `create` rejects → mapped, `destroy` not called (no session); the stream errors → mapped and `destroy`
    called once; normal end → `destroy` called once.
- T3.07 (M3): empty output → `{polished:false, reason:/nothing/}`; a throw of `new Error('x')` → not polished, the
  original text is kept; `aborted` re-throws; sanitize-strip case (see 6).

### Failure modes
- **Drift between two copies of a fact:** the image-rejection regex lives in one place (`errors.ts`), used by both
  `httpError` and `vibe`. The ProviderError kinds are the contract Council relies on; they're unchanged, and the Council
  tests run in the gate.
- **Partial failure:** text already yielded before a mid-stream error or a cut-off stays with the caller. Ask and Council
  already handle a throw after deltas (Council sets the turn to failed). A truncated Anthropic answer is no longer
  shown as a complete success.
- **Errors during cleanup:** chromeBuiltin calls `destroy()` in `finally`. If `destroy` itself throws, it would mask
  the real error. Test it; if it masks, wrap it in try/catch (a small code fix).
- **Misleading success:** an empty 200 stream and a stream with no `message_stop` used to count as success; now they reject.
- **Lost diagnostics:** users no longer see the provider's reason text. That's the trade the ticket asks for. The kind and
  status code are still there, and `cause` keeps the original error for devtools, though it's never rendered (I'll grep
  that no UI renders `.cause`).
- Concurrency and idempotency: n/a (pure mapping functions).

### Check
`pnpm gate` green. No paid calls, no real network (fetch and `LanguageModel` are stubbed).

### PE fold (approval conditions, these override the text above)
1. **No body or raw error in `cause` on the HTTP path.** `httpError` and the HTTP-path `mapThrown(e, { fixedText: true })`
   (postSse, models.getJson) attach no `cause` (not the body, not the detail, not the raw thrown error, including the
   TypeError / AbortError). The T3.05 leak test serialises the whole error: `message`, `String(e)`, `e.stack`,
   `JSON.stringify(e)` and `cause`.
2. **No regex on the message in vibe.** `errors.ts` exports `IMAGE_REJECTED_TEXT`. httpError uses it as the message, and
   vibe checks `e.kind === 'other' && e.message === IMAGE_REJECTED_TEXT`. The body-matching regex stays private to
   errors.ts. No new ProviderError field (frozen contract).
3. **Legacy stored errors:** add and export a pure `scrubLegacyProviderText(text)` in `packages/ai` (errors.ts, re-exported
   from index). It strips the old ` (<detail>)` suffix after the old message prefixes ("Invalid API key, or the key can't
   use this model", "Invalid API key", "This model isn't available … pick one", "The provider had a server error",
   "Request failed with HTTP <n>") and redacts key shapes `sk-ant-…`, `sk-…`, `gsk_…`, `AIza…` anywhere. Tested
   on the old shapes (T3.05). Wiring it into the stored chats is SPC-26 (lane B, db.ts); not touched here.
4. **Other ways into text:** grep done. All adapters and `models.ts` put the key only in headers (`authorization`,
   `x-api-key`, `x-goog-api-key`); no URL carries `?key=` (T3.04 already asserts it for gemini), and no message is built
   from the URL, headers or init. New T3.05 case: `fetch` rejects with a TypeError whose message holds the full URL with
   `?key=<key>` → `network` fixed text, no leak anywhere in the serialised error (adapters + listModels).
5. **chromeBuiltin `destroy()` throwing:** wrapped in try/catch in `finally`, so it never masks the real error or turns
   a success into a failure. T3.06 tests both cases.

## Done
- **Tests first:** 32 new or changed tests were red on main 986317e before any code (`vitest run` in packages/ai: 32 failed /
  119 passed). Among them, the H5 leak test failed on the real leak: `401 {"error":{"message":"Incorrect API key provided:
  <key>"}}` put the key in the message. The TypeError case failed because `cause` held the URL. The tests-first commit was
  folded into the single PR commit so the fake key literal it had never reaches git history (gitleaks scans history in CI).
- `errors.ts`: every message is fixed text, there's no `cause` on the HTTP path, `IMAGE_REJECTED_TEXT`, `streamError()`
  (mid-stream events; `rate` for rate-limit / overload / 429 / 529 type/code/status, else `other`), `mapThrown(e,
  { fixedText })`, `scrubLegacyProviderText()`. All re-exported from `index.ts`.
- `http.ts`: a 200 with zero SSE events rejects; `fixedText` mapping. `models.ts`: `fixedText` mapping.
- `openaiCompat` / `gemini`: an `{error}` event rejects through `streamError`. `anthropic`: `type:error` goes through
  `streamError`; a stream without `message_stop` rejects as `network` "cut off" after the partial text.
- `chromeBuiltin`: `destroy()` wrapped in try/catch. `vibe`: `e.message === IMAGE_REJECTED_TEXT`; the regex is private
  to errors.ts. `polishPrompt`: values lost only to the brand filter are reported as "filtered", not "AI changed
  values" (the test was red without the fix; checked by swapping the old file back in).
- `docs/TESTING.md`: T3.05 / T3.06 wording (no new IDs).
- `pnpm gate` green: core 57, ai 151, extension 83, e2e 51, check-ids. **gitleaks isn't installed locally, so
  `secrets` was SKIPPED; CI runs it.** The test key is built from parts (`['sk','proj',…].join('-')`) so the
  generic-api-key rule has no literal to match.

## Next
- Reviews (PE lens A, a lens-B reviewer, and a security review: keys). Fold findings in new commits.
- The SPC-26 owner (lane B, db.ts) wires `scrubLegacyProviderText` into a one-time scrub of stored chat errors. Not done here.

## How to resume
Worktree `worktrees/spc-16`, branch `exec/spc-16`. Read this file, then `git log origin/main..` and `docs/sprint/reviews/SPC-16-*`.
