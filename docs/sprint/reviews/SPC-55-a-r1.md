# SPC-55 lens A r1 (PE pe-b2, 2026-10-17)

PR #55 @ 2e61a91, base `exec/spc-46`: `features/vibe.ts`, `vibe.test.ts` (T3.35), and the TESTING.md row. `packages/ai`:
229/229 green here.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 1 LOW.**

## Checks
- **Retry budget (my ruling):** `cappedDown` and `contentRetried` flags, each used once, so there are at most 3 calls,
  and the final error is rethrown as is. The exact-3-fetches test pins it. Only `ProviderError` kind `other` is ever
  retried, so abort, rate and auth errors are thrown at once. `TRUNCATED_TEXT`, filtered and cut-short replies match no
  branch and are rethrown (SPC-34: cut-off text is never parsed).
- **Cap-down:** triggered on `TOO_LONG_TEXT` or the generic HTTP 400, and only when `min(4096, ctx/4)` is actually
  smaller. So a 4k Gemma (cap already 1024) never makes a useless retry. The reduced cap sticks. Gemini's camelCase
  400 is tested through the real `createGemini`/`httpError` path. The o-series case gives 2 fetches, then a
  rethrow (no loop).
- **Content retry:** `IMAGE_REJECTED_TEXT` → text-only with JSON on (unchanged behaviour). `MID_STREAM_TEXT` →
  text-only and JSON off (Groq's `json_validate_failed`, through the real `createOpenAICompat` with fake Groq SSE).
  The retry keeps the system prompt and the `<page_data>` wrapper (tested). The provider text is never read (the
  key-echo test).
- **`usedImage`** comes from the attempt that succeeded. The owner's cap `min(10000, ctx/4)` is in one constant.

## LOW
### L1. `HTTP_400_PREFIX` is a second copy of `httpError`'s generic 400 text
If SPC-30 (or anyone) rewords that message in `errors.ts`, vibe's cap-down silently stops firing for Gemini
8k models. The Gemini test goes through the real `httpError`, so it *would* fail, which is good enough for now.
**Follow-up (SPC-30's lane, after merge):** export that text as a constant from `errors.ts` and import it here.

**Stack note:** the base `exec/spc-46` moved to 9d17ce2 (the lens B fold, openaiCompat only). Rebase #55 onto it.
vibe.ts wasn't touched there, so it should be clean.
