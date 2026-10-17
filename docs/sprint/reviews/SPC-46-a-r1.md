# SPC-46 lens A r1 (PE pe-b2, 2026-10-17)

PR #54 @ c46b236, base `exec/spc-41`: the three adapters, `providers/http.ts` (CUT_SHORT_TEXT, FILTERED_TEXT),
`features/vibe.ts` (output cap), tests, and the TESTING.md rows. `packages/ai`: 218/218 green here.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 1 LOW.**

## Checks
- **No contract change:** `'other'` with fixed texts, and `errors.ts` is untouched (MID_STREAM_TEXT is only imported).
  Nothing from an event is copied.
- **End of stream:** openaiCompat counts a reply as whole on `[DONE]` *or* any non-null `finish_reason`, so the Ollama
  `[DONE]`-only and the `stop`-without-`[DONE]` negatives pass. Gemini needs a `finishReason` string. Anthropic keeps
  `message_stop`, now through the shared constant (the same text, so no UI drift).
- **Ordering:** the chunk's text is yielded before any throw, there's one throw, and nothing is read after it
  (table-driven, like SPC-41's). Exact-value sets only. `tool_calls`, `stop_sequence`, `tool_use` and Gemini `OTHER`
  stay whole.
- **Abort:** `postSse` maps an abort before the loop ends, so the after-loop throws never fire on Stop (T3.06 unchanged).
- **The owner's Vibe report (Groq gpt-oss-20b, "error mid-response"):** #54 makes it **better, not worse**. vibe's cap
  goes from 300 to `min(1200, ctx/4)` = 1200 on Groq, so reasoning no longer burns the whole budget, which is the likely
  trigger of Groq's mid-stream `json_validate_failed`. #54 doesn't change how a mid-stream error event is mapped
  (still `MID_STREAM_TEXT` through `streamError`), and vibe still doesn't retry it. That's SPC-55.

## LOW
### L1. On a 4k-context local Gemma, vibe's output cap goes from 300 to 1024
The page data budget for 4k is ~6.5k chars, and compact JSON with many hex values can tokenize densely. Prompt plus a
1024-token cap then comes close to 4096, and WebLLM rejects a request whose prompt plus `max_tokens` exceeds the
context window. This is the same arithmetic critique already uses (`turnMaxTokens` = ctx/4 with the same page
budget), so it's consistent and not a new class of risk. Add a line to the owner's manual steps: "Vibe with local
Gemma on a long page". If it fails, it fails as `TOO_LONG_TEXT`, never silently. No re-review needed.
