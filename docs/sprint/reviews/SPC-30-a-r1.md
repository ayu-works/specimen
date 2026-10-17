# SPC-30 lens A r1 (PE pe-b2, 2026-10-17)

PR #52 @ 4ba1fb2, base `exec/spc-41`: `errors.ts`, `index.ts` exports, the one line in `critique.ts`, tests, and the
TESTING.md rows. `packages/ai`: 209/209 green here.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW.**

## Checks
- **Contract unchanged:** `kind:'other'` + the exported fixed `OUT_OF_CREDIT_TEXT`. `ProviderErrorKind` is untouched.
  The council compares against the imported constant, not a copy of the string.
- **Classification order:** credit runs before 401/403 → auth and before 429 → rate (the comment says so, and the tests
  "credit wording beats the 400/403 branches" and 429 `insufficient_quota` pin it).
- **Billing is matched on codes:** `CREDIT_CODE` is anchored, and only string `code`/`type` are read, so Gemini's
  numeric `code: 429` is ignored. Gemini's per-minute and per-day `RESOURCE_EXHAUSTED` 429s stay `rate` (my note a),
  and OpenAI's "exceeded your current quota" wording alone isn't matched.
- **Key safety:** the body is only tested, never copied, and the message is fixed text (the existing leak tests cover it).
- **No retry:** `'other'` is never retried by critique, and the council shows the out-of-credit text (T3.21).
- `streamError` checks `creditCode` first. Note for the owner's Vibe report: this PR does not change how a mid-stream
  *image* rejection is handled (it's still `MID_STREAM_TEXT`). That's a separate follow-up.
