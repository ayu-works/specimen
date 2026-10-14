# SPC-16 review: lens B + security, round 1

Reviewer: second reviewer (lens B + security), read-only. PR #28, branch `exec/spc-16` at 147a3eb.
Read: setup.md, SPC-16 and its comments (PE plan fold 1-5), audit H5/H12/M1/M3, handoff, `gh pr diff 28`, and the
extension call sites that render or store provider errors (Ask.tsx, Byok.tsx, Generate.tsx, Vibe.tsx, critique.ts, db.ts).

**Verdict: no CRITICAL or HIGH findings. The key-leak fix holds.** 0 CRITICAL, 0 HIGH, 3 MEDIUM, 4 LOW.

## Key-material sweep (what I checked and found closed)
- **HTTP bodies:** `httpError` builds only fixed strings. The body is parsed for classification and then dropped. There's
  no `cause`, and only `res.status` (a number) goes into the text. Partial, URL-encoded, base64, JSON-nested or
  header-echo keys in a body can't reach the message, because no body text reaches it at all. The T3.05 matrix
  serialises message, `String(e)`, stack, JSON and cause, so it covers this structurally.
- **Thrown errors on the HTTP path** (`postSse`, `models.getJson`): `mapThrown(e, { fixedText: true })` drops the
  thrown text and the cause, including a V8 `SyntaxError` from `res.json()`, which quotes a snippet of the body. Good.
- **Mid-stream events:** `streamError` reads only `type`/`code`/`status` to pick `rate` vs `other`. It never copies text.
- **Query string:** gemini sends `x-goog-api-key` in a header, and `listModels` does the same. No `?key=` anywhere.
- **Logs:** there's no `console.*` of errors in `apps/extension/src` or `packages/ai/src`.
- **UI and storage:** Ask stores `e.message` in `db.ts` `error`, Byok/Generate/Vibe render `e.message`, and Council
  renders only `CRITIQUE_ERRORS[kind]`. All of these now get fixed text. No UI renders `.cause`.
- **Non-HTTP paths** (`chromeBuiltin`, `webllm`, default `mapThrown`) still echo `e.message`, but no API key exists on
  those paths. Acceptable.

## MEDIUM

### M1. A 400 for a retired model whose id contains "vision" or "image" is reported as "This model can't read images."
- Code: `errors.ts` `httpError` checks `IMAGE_REJECTED` (which matches the bare words `image` and `vision`) **before**
  the model-gone check. Moving the regex out of `vibe.ts` into `httpError` puts that classification on every 400/422,
  for every feature, not just vibe.
- Failure scenario: a user on Groq has `llama-3.2-90b-vision-preview` saved (now decommissioned). They use **Ask**,
  which is text-only. Groq answers `400 {"error":{"message":"The model \`llama-3.2-90b-vision-preview\` has been
  decommissioned…","code":"model_decommissioned"}}`. `detail` contains "vision", so the user sees "This model can't
  read images." That's wrong, and it doesn't send them to "Fetch models". On main they got the model-gone message.
  In **Vibe**, the same body triggers a pointless text-only retry, which fails the same way and surfaces the same wrong
  text. Any 400 that names a model id containing `image`/`vision` (e.g. `…-vision-instruct`) behaves this way.
- Fix: run the model-gone check (404 or `/model.*(not (exist|found)|decommission|deprecat)/`) before the image check.
  Also tighten `IMAGE_REJECTED` so it doesn't match a bare `image`/`vision` (e.g. require `image_url`,
  `content must be a string`, `does not support (image|vision|multimodal)`, `unsupported content`). Add T3.05 cases:
  400 "model `x-vision-preview` has been decommissioned" → model-gone text; 400 "image_url is not supported" → image text.

### M2. A context-length or bad-parameter 400 is now an opaque "Request failed with HTTP 400."
- Code: `httpError`'s fallback. Before this PR, the provider's reason rode along in the suffix. It's now dropped (by
  design), but nothing replaces it for the most common non-key 400.
- Failure scenario: Ask or Generate's polish on a large scan with a small-context model (Groq 8k, a local Ollama model
  behind openai-compat). OpenAI-style answer: `400 {"error":{"code":"context_length_exceeded",…}}`. The user sees
  "Request failed with HTTP 400." and has no idea that shortening the question or picking a bigger model fixes it.
  Same for `max_tokens is too large` / `max_completion_tokens` parameter errors on newer OpenAI models. The issue asks
  for a "useful, fixed error message" for each class, and this is the one class users will actually hit.
- Fix: one more fixed-text class in `httpError` for 400/413/422 matching
  `/context[_ ]length|maximum context|too many tokens|prompt is too long|request too large|max_(completion_)?tokens/i`
  → `other` "The request is too long for this model. Ask a shorter question or pick a model with a larger context."
  (kind stays `other`, so Council is unaffected). Add a T3.05 case. Optional: a 400 that matches nothing could say
  "The provider rejected the request (HTTP 400). Check the model in Settings." instead of the bare status.

### M3. `scrubLegacyProviderText` can over-redact if SPC-26 runs it over anything but the stored `error` field, and its key shapes miss several presets.
- Code: `errors.ts` `LEGACY_SUFFIX` is anchored only at `$`, not `^`. `KEY_SHAPES` covers `sk-`, `sk-ant-`, `gsk_` and
  `AIza`, and uses the lookbehind `(?<![A-Za-z0-9])`.
- Failure scenarios:
  1. Over-redaction: if SPC-26 scrubs assistant `content` as well as `error` (the export doesn't say which), then an
     answer ending in "…return Invalid API key (401) from your handler)" loses its parenthetical. Ask stores
     `e.message` verbatim, so a legacy error always *starts* with the prefix, and a `^` anchor costs nothing.
  2. Missed shapes in unprefixed legacy text (old anthropic mid-stream `error.message`, old `mapThrown` fallback
     `e.message`): xAI `xai-…`, Mistral (32 bare alphanumerics), Together (64 hex) and custom keys are not redacted.
     A key glued to a preceding letter or digit (e.g. URL-encoded `key%3DAIzaFAKEFAKEFAKE`, where the char before
     `AIza` is `D`) defeats the lookbehind. The real exposure is small: prefixed messages lose the whole suffix
     anyway, and the unprefixed sources rarely echo keys. But SPC-26 will treat this function as "the" scrub.
- Fix: anchor the suffix as `^(…) \([\s\S]*\)$`, and say in the JSDoc that the function is for the stored `error`
  field only. Add `xai-[A-Za-z0-9]{8,}` to `KEY_SHAPES`, and drop the alphanumeric lookbehind for the prefixed shapes
  (or allow `%3D`/`=`/`:` explicitly). Better still for SPC-26: also redact the user's *currently stored* key(s)
  verbatim and URL-encoded, which covers Mistral, Together and custom keys exactly with no shape guessing. Add tests
  for `xai-FAKE…`, `key%3DAIzaFAKE…`, and a non-error sentence containing "Invalid API key (x)" left alone (once
  anchored, so only exact legacy messages are touched).

## LOW

### L1. The chromeBuiltin "already-aborted signal" test passes whatever the adapter does with the signal.
- `chromeBuiltin.test.ts` "an already-aborted signal…": the stub's `create` throws `AbortError` unconditionally, so the
  test would pass even if the adapter stopped passing `signal` to `create`/`promptStreaming`, or ignored it.
- Fix: have the stub's `create` throw only when `opts.signal?.aborted`, and assert `create` received the same signal
  object. Optionally add an adapter-side `if (signal?.aborted) throw new DOMException('Aborted','AbortError')` before
  `create`, as `postSse` does, so an already-aborted run doesn't rely on Chrome honouring it. The **mid-stream** abort
  test does drive the real path (the `hang` stream, `onAbort` → `reader.cancel` → `done` → `AbortError`, `cancel` and
  `destroy` asserted once). Good.

### L2. A cut-off Anthropic stream is `network`, so Council says "Can't reach the provider. Check your connection…"
- `anthropic.ts` throws `network` "The response was cut off. Try again." Ask shows that accurate text. Council maps it
  through `CRITIQUE_ERRORS.network`, which blames the connection. That's mostly right, since a cut-off is usually a
  connection drop, but it's misleading when the server closed the stream on purpose. No retry happens either way.
- Fix: none required. If you want accuracy, use kind `other` (Council: "The provider returned an error. Try again…").
  Note it in the handoff either way, since SPC-24 shares these kinds.

### L3. A 200 with zero SSE events changes Council's turn status from `empty` to an error.
- The handoff says empty-text streams keep Council's `empty` status, which holds for streams *with* events. A
  zero-event 200 from openai-compat or gemini used to resolve and give the turn `empty`, with its "a reasoning model
  can spend its whole budget thinking" hint. It now rejects as `other`, so the turn fails with the generic text.
  Probably the better outcome, but it's an unflagged Council behaviour change.
- Fix: add one line to the handoff and SPC-24 notes, or add a critique test that pins the new status.

### L4. vibe's "does not retry for another 400 whose text merely mentions an image" test no longer tests a reachable case.
- `vibe.test.ts` hand-builds `new ProviderError('other', 'Request failed: image too large')`. Through the real
  `httpError`, a 400 "image too large" now becomes `IMAGE_REJECTED_TEXT`, so vibe *does* retry text-only. The test
  guards a message shape that can no longer occur, and the real behaviour for that body isn't pinned.
- Fix: build that case with `httpError(new Response(…400…))` and assert what you actually want: a retry is fine for
  "too large". If M1's tightened regex should not match "image too large", assert no retry.

## Not findings (checked)
- 401/403 → auth fixed text; 429 → rate (unchanged; Council back-off intact); 5xx → fixed server text; offline
  `TypeError` → network fixed text; unknown throw → "The provider request failed." All are useful and fixed.
- Council: `ProviderErrorKind` is unchanged. A mid-stream `overloaded_error` / `RESOURCE_EXHAUSTED` / `rate_limit` now
  maps to `rate`, so Council backs off where it used to fail. That's an improvement.
- `destroy()` in try/catch: both the masking test and the success test drive it.
- polishPrompt "filtered" reason: correct, and limited to values the brand filter removes from the original itself.
- Pre-existing, not this PR: OpenAI `429 insufficient_quota` (billing) is treated as `rate`, so Council retries ~80 s
  for nothing and the text says "wait a minute". Worth a later ticket: classify `insufficient_quota` as `auth`/`other`
  with "Your provider account is out of credit."
