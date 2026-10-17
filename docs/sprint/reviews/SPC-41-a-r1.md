# SPC-41 lens A r1 (PE pe-b2, 2026-10-17)

PR #45 @ b3942ab: the three BYOK adapters, `types.ts` (the `chat` doc), `providers.test.ts`, and TESTING.md rows
T3.02–T3.04. `packages/ai`: 193/193 green here.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW.**

## Checks
- **No partial text lost, nothing yielded twice:** in each adapter the chunk's text is yielded before the finish check.
  Anthropic's `message_delta` carries no text, and all its deltas come before it. The throw ends the generator, so
  nothing after it is read: the Gemini test feeds a trailing empty `MAX_TOKENS` chunk and a "!" chunk, and neither
  shows up.
- **The plan notes are covered:** OpenAI's separate empty-delta `length` chunk is tested, the Gemini trailing chunk
  is tested, and the `LLMProvider.chat` doc states the contract.
- **No false positives:** `stop` / `end_turn` / `STOP` end as whole replies (tested). Only the exact limit values
  trigger the throw. SAFETY, `content_filter` and the like are unchanged, as scoped.
- **Key safety (SPC-16):** the error is the fixed `TRUNCATED_TEXT`, with no `cause`, and the tests check the message,
  `String`, the JSON and the stack for the key. It's thrown from inside the adapter's loop, so `postSse`'s cleanup
  (`return()` → reader released) runs as on the existing error path.
- **Callers:** they all match on `TRUNCATED_TEXT` without caring which provider sent it (council, polishPrompt, ask,
  vibe), so none needs an edit. The contract extension went to specimen-75 as a ruling ("recommend yes").
- **Tests can fail:** on main, each "cut" case resolves with no error, so `expectTruncated(undefined)` fails.
