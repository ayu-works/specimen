# SPC-46 lens B r1 (PR #54)

Reviewer: fresh lens B, 2026-10-17. Read: setup.md, SPC-46 (Linear, 1 comment), handoff, `gh pr diff 54`, the three
adapters, `http.ts`, `errors.ts`, `sse.ts`, `collect.ts`, `vibe.ts`, `critique.ts` (error mapping), `Byok.tsx` Test.
`packages/ai` vitest: 12 files, 218 tests pass.

**Count: 0 CRITICAL · 0 HIGH · 2 MEDIUM · 4 LOW.**

## Main question: can a normal, complete reply now be reported as an error?
I found no common provider where this happens. Here is each stream shape I checked against the new code:
| Shape | Result |
|---|---|
| OpenAI, Groq, xAI, DeepSeek, Mistral, Together: `finish_reason` chunk, then a usage-only chunk (`choices: []` or `x_groq`), then `[DONE]` | whole (`finished` is set by the earlier chunk; `[DONE]` returns before the check) |
| OpenRouter: `: OPENROUTER PROCESSING` comments, normalized `finish_reason`, `[DONE]` | whole (comments are dropped in `sse.ts`) |
| Ollama `/v1`, LM Studio, vLLM, llama.cpp (new): `finish_reason:"stop"` + `[DONE]` | whole |
| llama.cpp/LM Studio builds that send only one of `[DONE]` / `finish_reason` | whole (both negatives are tested) |
| Together/TGI `finish_reason:"eos"` / `"eos_token"` | whole (any non-null value counts) |
| Azure: the first chunk has `choices: []` + `prompt_filter_results` | ignored, whole |
| Gemini: `finishReason:"STOP"` on the last chunk with `usageMetadata`, or on a chunk with no `content` | whole |
| Gemini: a non-blocked chunk with `promptFeedback.safetyRatings` but no `blockReason` | whole (only `blockReason` is checked; proto3 JSON leaves out the default `BLOCK_REASON_UNSPECIFIED`) |
| Anthropic: `message_delta` (always has `stop_reason`), then `message_stop` | unchanged |
| Consumer `break`s or aborts (Byok Test, Stop) | the after-loop throw never runs: `return()` unwinds, and abort becomes `aborted` in `postSse` |

Only a server that sends **neither** `[DONE]` **nor** any `finish_reason` is affected. That shape is non-conformant,
and "cut off" is the honest answer for it (see L2 for the opposite gap).

Error text: every new throw uses a fixed constant, has no `cause`, and copies nothing from the event (the key-echo rule
in `errors.ts` holds). The key-safety test covers all the new cases.

Council: `critique.ts:643` exact-matches only `TRUNCATED_TEXT`. `CUT_SHORT_TEXT` and `FILTERED_TEXT` therefore go to
the generic `CRITIQUE_ERRORS.other` line with the partial turn text kept, and nothing is retried. That is correct,
just less specific (the handoff already lists it as a follow-up). Vibe rethrows both new errors unchanged. Byok Test
is unaffected.

## MEDIUM

### M1. Vibe's 1200 cap can still be used up by Gemini 2.5 Pro / 2.5 Flash thinking on an image, so it fails as "hit the length limit"
`vibe.ts`: `Math.min(1200, ctx/4)`. Gemini 2.5 Pro can't turn thinking off, and 2.5 Flash uses dynamic thinking. Both
count thoughts against `maxOutputTokens`, and on an image + JSON prompt they often think for 1–2k tokens.
**Scenario:** the owner picks `gemini-2.5-pro` and clicks Vibe with a screenshot. Thinking uses ~1300 tokens, the
chunk ends with `finishReason:"MAX_TOKENS"` and no text, and the user sees `TRUNCATED_TEXT`. That is the same failure
L4 was meant to fix. Reusing critique's turn cap is reasonable for a turn whose visible output is long. For vibe the
visible output is ~100 tokens, so the whole cap exists for thinking.
**Fix:** use a larger cap for big-context providers, e.g. `Math.min(4096, Math.floor(ctx / 4))`. Gemma/4k still gets
1024, and `maxTokens` is a ceiling, so non-thinking models cost the same. Or add one text-only retry with no cap
change. Either way, add a test: a 1M-context provider gets ≥ 4096. (I can't confirm the exact thinking spend
without a real call. The point is that 1200 has little headroom.)

### M2. Owner's "The provider reported an error mid-response." on Vibe: #54 helps one likely cause and doesn't fix the other (out of scope)
`MID_STREAM_TEXT` comes only from an `{error:…}` event inside a 200 stream (`streamError`), or now also from
`finish_reason` `error`/`insufficient_system_resource`. Vibe's text-only retry (`vibe.ts:127`) only fires on
`IMAGE_REJECTED_TEXT`, which only `httpError` produces on an HTTP 400/422. Two likely causes:
1. **Budget:** on Groq-style JSON mode, a reply cut at `max_tokens: 300` (or used up by gpt-oss reasoning) fails JSON
   validation. Groq reports that as an in-stream error event (`json_validate_failed`), so the user sees
   `MID_STREAM_TEXT`. **#54 makes this better** (300 → 1200).
2. **Image/JSON rejected after the 200 was committed:** OpenRouter (and other routers) send headers first, then
   report an upstream 400 (model can't take the image, or doesn't support `response_format`) as
   `{"error":{"code":400,…}}` in the stream. `streamError` only looks at `type`/`code`/`status`, so this becomes
   `MID_STREAM_TEXT` and the text-only retry never runs. **#54 doesn't change this.** It isn't worse either:
   OpenRouter's `finish_reason:"error"` comes with an `error` object, which is already checked first.

**Out of scope for SPC-46.** Fix in a new ticket: in `streamError`, test the event's `message` against the existing
`IMAGE_REJECTED` regex (read to classify only, never copied, the same as `httpError`'s `detail`) and return
`IMAGE_REJECTED_TEXT`. Or have vibe retry text-only once on any `kind:'other'` failure when `usedImage`. To pin down
the actual cause, ask the owner which preset/model shows the error.

## LOW

### L1. Raising the vibe cap 4× makes a JSON-mode whitespace runaway 4× longer
Some models in `json_object` mode (older OpenAI and Groq Llama builds, some local servers) keep emitting whitespace or
newlines until `max_tokens`. **Scenario:** a local Llama on Ollama streams 1200 tokens of `\n` before
`finish_reason:"length"`, which is slower and still ends in `TRUNCATED_TEXT`. Cost to the user: latency/tokens only.
**Fix:** none needed now. If M1 raises the cap further, consider aborting vibe once there is a run of more than N
whitespace-only deltas after `{`.

### L2. openaiCompat counts `finish_reason: ""` as finished; Gemini doesn't (inconsistent)
`openaiCompat.ts:74` checks `finish == null`, so an empty string sets `finished = true`. Some servers (LocalAI,
several non-US OpenAI-compatible APIs) send `"finish_reason": ""` on every intermediate chunk.
**Scenario:** such a server drops the connection cleanly after the first chunk. `finished` is already true, so the
partial reply is shown as whole. That is the bug L1 fixed, coming back for those servers. It never causes a false
error. Gemini requires a non-empty string, so the two adapters disagree.
**Fix:** `if (finish == null || finish === '') continue;` plus a negative test (`""` chunks, then a clean EOF →
`CUT_SHORT_TEXT`; `""` chunks, then `"stop"` → whole).

### L3. Missing negative tests for the most common real end shapes
The `whole[]` list has no case for an OpenAI usage-only final chunk (`{"choices":[],"usage":{…}}`, which OpenAI sends
with `stream_options.include_usage` and Groq sends with `x_groq`) after `finish_reason:"stop"` and before `[DONE]`. It
also has no case for a usage-only chunk followed by a clean EOF with no `[DONE]`. Both pass today. They are the
shapes most likely to break if the loop is refactored later.
**Fix:** add both to `whole[]` (T3.02). Optionally add an OpenRouter `: OPENROUTER PROCESSING` comment line to one
existing case.

### L4. Council and Ask show the generic line for a filter stop (follow-up already noted)
`critique.ts:643` → `CRITIQUE_ERRORS.other` ("…pick another model in Settings"). For `FILTERED_TEXT` that advice is
acceptable, but the user isn't told that a filter caused it, and for `CUT_SHORT_TEXT` "pick another model" is
misleading (it was a dropped stream).
**Fix (follow-up, not this PR):** export both constants from `errors.ts`/`index.ts` and map them in `critique.ts` the
way `TRUNCATED_TEXT` is mapped. Keep the handoff's follow-up line.

### Note (pre-existing, not #54)
For OpenAI reasoning models (o-series, gpt-5) through openaiCompat, a 400 saying "Unsupported parameter:
'max_tokens'… use 'max_completion_tokens'" matches `TOO_LONG_TEXT`'s `max_(?:completion_)?tokens` regex. Vibe then
says "The request is too long…". This is worth a separate ticket if the owner uses the OpenAI preset with a reasoning
model.
