# SPC-41 review: lens B + security, round 1

PR #45 (`exec/spc-41` @ b3942ab). Reviewer: second reviewer (lens B + security). Read-only.

**Verdict: changes requested.** There is 1 HIGH, 1 MEDIUM and 4 LOW. The adapter change itself is correct and key-safe. The HIGH is a caller the plan said needed no change, and it does.

## HIGH

### H1. BYOK "Test" now fails on reasoning models: the Groq and Gemini presets' default models
`apps/extension/src/entrypoints/options/Byok.tsx:136-158`. The Test button sends `maxTokens: 32`. Its comment says reasoning models "spend their first tokens thinking". It also has a dedicated success message for that case: "Works: connected to … (It returned no text for this tiny test, which is normal for reasoning models.)"
- **Scenario:** the user picks the Groq preset (default `openai/gpt-oss-20b`, a reasoning model) and clicks Test. Groq spends all 32 tokens on `delta.reasoning`, yields no `content`, and ends with `finish_reason: "length"`. Before this PR, the loop ended normally and the user saw "Works: connected". Now `openaiCompat` throws `ProviderError('other', TRUNCATED_TEXT)`. The `catch` only treats `aborted` as success, so the user sees a red **"The answer hit the length limit and was cut off."** for a key and model that work. The same happens with Gemini's default `gemini-2.5-flash`, whose thinking tokens count against `maxOutputTokens` (32), so the reply is `MAX_TOKENS` with no parts. xAI's default `grok-3-mini` and DeepSeek reasoner models are likely affected too. This is the first thing a new BYOK user does, and the "connected" branch it replaces now runs only when a stream ends with `stop` and no text.
- When text does arrive, the loop `break`s on the first delta and aborts, so the throw is never reached. Only the no-text case regresses.
- The contract ruling says "the callers already handle it". That holds for critique, Ask, polish and vibe, but not for this caller.
- **Fix:** in `test()`'s catch, treat `e instanceof ProviderError && e.message === TRUNCATED_TEXT` as success. Show the "connected" message, or "answered" if `got`. Add a T3.13 case to `apps/extension/test/options.test.tsx`: an SSE stream with no content and `finish_reason:"length"` (or Anthropic `max_tokens`) shows `/Works: connected/`, not an alert.

## MEDIUM

### M1. Mistral's `model_length` (context window full) still passes as a whole reply
`openaiCompat.ts:68` only matches `'length'`. Mistral, a shipped preset (`api.mistral.ai/v1`), documents `finish_reason` as `stop | length | model_length | error | tool_calls`. `model_length` is Mistral's version of Anthropic's `model_context_window_exceeded`, which this PR already treats as a cut-off.
- **Scenario:** a long council turn on `mistral-small-latest` fills the context. The stream ends with `finish_reason:"model_length"`, so the council parses truncated JSON and Ask stores the cut-off answer as complete. This is the exact bug SPC-41 fixes, on one preset.
- **Fix:** use a `CUT_OFF = new Set(['length', 'model_length'])` like `anthropic.ts`, and add a T3.02 case. I checked the other OpenAI-compatible presets and servers (OpenAI, OpenRouter (normalized), Groq, Together, xAI, DeepSeek, Ollama `/v1`, LM Studio, llama.cpp, vLLM). They all report the token limit as `'length'`, so no other value is needed.

## LOW

### L1. A clean stream end with no stop reason still passes as complete (openaiCompat, Gemini)
Anthropic throws if `message_stop` never arrives (`anthropic.ts:84`). openaiCompat and Gemini have no such check. If a proxy, corporate gateway or idle timeout closes the SSE body cleanly mid-reply, with no `[DONE]`/`finish_reason` (OpenAI) and no `finishReason` (Gemini), the loop ends normally and the partial text passes as whole. This was already the case before the PR and is outside the ticket's token-limit scope, but it is the same misleading-success class.
- **Fix (follow-up ticket):** track `sawFinish` and, after the loop, throw the same fixed "The response was cut off. Try again." Gate this carefully for local servers, and test that a `[DONE]`-terminated stream with no explicit `finish_reason` still passes.

### L2. Other non-normal stop reasons are correctly *not* treated as truncation, but they also still pass as complete
I confirmed the exact-match checks never fire on `stop`, `stop_sequence`, `tool_use`, `end_turn`, `refusal`, `pause_turn`, `content_filter`, `tool_calls`, `SAFETY`, `RECITATION`, `BLOCKLIST` or `OTHER`, and `String(undefined)` is not in the set. So there is no false positive. But a Gemini `SAFETY`/`RECITATION` stop mid-reply, an OpenAI `content_filter`, Mistral `error` or DeepSeek `insufficient_system_resource` still shows a cut reply as whole. The handoff scopes these out, which is fine for this PR.
- **Fix:** add a follow-up ticket that maps these to a fixed message (for example `MID_STREAM_TEXT` or a new "stopped by the provider's filter" message), never echoing the event.

### L3. The tests have no negative cases for the stop reasons that must not trigger
`providers.test.ts` `whole[]` only covers `stop` / `end_turn` / `STOP`. Add `stop_sequence` and `tool_use` (Anthropic), `content_filter` (OpenAI) and `SAFETY` (Gemini) to `whole[]` so a later widening of the match, for example to a substring or `!== 'stop'`, fails a test. These are three rows of data and cost almost nothing.

### L4. `vibe` (maxTokens 300) now errors where it used to fall back to a partial summary
`vibe.ts:96`. A truncated JSON reply used to fall back to a `cutText(raw)` summary. Now `collect` rethrows `TRUNCATED_TEXT` and the Vibe card shows the error. This matches Gemma since SPC-34 and the ruling accepts it, so no change is needed for correctness. However, `gemini-2.5-flash` thinking tokens count against the 300, so the error may be common on the default Gemini preset.
- **Fix (optional, follow-up):** raise vibe's `maxTokens`, or set `thinkingConfig.thinkingBudget` low for this call.

## Checked, no finding
- **Ordering:** the deltas from the finishing chunk are yielded before the throw in all three adapters. Anthropic's `message_delta` comes after all `content_block_delta`s. The generator throws once and nothing is read after it. The OpenAI shape with an empty-delta finish chunk is tested.
- **Key safety (SPC-16):** the thrown message is the fixed `TRUNCATED_TEXT`, with no `cause` and nothing copied from the event. `mapThrown` passes `ProviderError` through unchanged. The test asserts that the message, `String`, JSON and stack never contain the key. No raw body is echoed.
- **Callers:** critique (`critique.ts:643`) keeps the sanitized partial `turn.content`, fails with `CRITIQUE_TRUNCATED` and does not retry. `ask` → `collect` flushes the full sanitized partial text before rethrowing, and `Ask.tsx:144` renders the partial text plus the error line. `Council.tsx:54` likewise. There is no crash or silent discard. Byok Test is the exception (H1).
- **Network:** the tests use only `vi.stubGlobal('fetch')` with `sseResponse`, with no real network.
- **Streaming vs non-streaming:** all three adapters only stream (verified), so there is no second path to cover.
