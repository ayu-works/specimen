# SPC-34 lens A + contract r1: PR #36 @ d63b397 (pe-8a, 2026-10-17)

**Verdict: APPROVED.** 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW.

## Contract (owner OK 2026-10-17): conforms
- `llmProtocol.ts`: `done` gains `truncated?: true` and nothing else. The old shape still type-checks, and
  ARCHITECTURE.md's Port `llm` row documents the field.
- Host precedence (`llmHost.ts` runChat) is stopped → `error aborted`, then `'abort'` → `error other`, then
  `'length'` → `done{truncated}`, then `done`. That matches the ruling.
- `WebLLMClient.chat` yields every delta and then throws `ProviderError('other', TRUNCATED_TEXT)`. `LLMProvider`
  and `ProviderErrorKind` are unchanged, so `CRITIQUE_ERRORS` and the other adapters are untouched.

## Consumers
- **Council** (`runTurn`):
  - `mapThrown` returns the same `ProviderError`, so the message keeps the exact constant.
  - The truncated check runs after the rate-limit retry branch, so a cut-off reply is never retried.
  - It fails the turn with `CRITIQUE_TRUNCATED`. The turn keeps its sanitized partial text and there is no
    verdict; the end-to-end test drives this through the real Port and a summary whose text would parse.
- **Polish (build note 2):** on truncation it keeps the original prompt with reason `TRUNCATED_TEXT`. The new
  T3.07 test pins it; it passes on main as well, because polish already falls back on any error.
- **Vibe:** rejects with `TRUNCATED_TEXT` and never parses the text. Pinned.
- **Ask (the side effect the orchestrator asked about):** a bubble with both `content` and `error` now shows the
  content above the error line.
  - The content only ever comes from `onText` and `final`, which are sanitized snapshots from `ask()`, so nothing
    raw is shown.
  - History still filters `!m.error && m.content`. The test checks that a cut-off answer is never replayed, live
    or after a reload from `loadChat` (build note 3).
  - Other errors (a user Stop, a mid-stream provider error) now also show what had streamed. That's correct:
    the text was already shown during the stream, and the error line says it isn't a whole answer.
  - Chats saved before this PR can show content that was hidden before. It was sanitized at stream time too, so
    nothing new is exposed.

## Can the tests fail?
In the PE worktree at 2bac238, I copied in the PR's tests together with its type and constant files
(`errors.ts`, `index.ts`, `llmProtocol.ts`), keeping main's behaviour code (`llmHost.ts`, `webllm.ts`,
`critique.ts`, `Ask.tsx`):
- `packages/ai`: 3 failed (the T3.11 client test and T3.21 ×2) and 78 passed.
- `apps/extension`: 3 failed (T3.12 Ask, the T3.11 host test and the T3.11 end-to-end test) and 33 passed.
The polish and vibe tests pass on main, as expected: they pin behaviour that main already has.

## Fold check (pe-4d, 2026-10-17): lens B r1 fold @ cb1bc74, APPROVED
- **M1 (Council shows partial text):** `TurnBody` renders `t.content` above the error as a React text node.
  Council error turns always hold `safe(raw)` (critique.ts:621), so it's sanitized. `Report`/verdict stay gated on
  `done`, so no verdict appears on a cut. T3.33 fails on 81f7c0c's Council.tsx ("…length limit" without the partial text).
- **L1 (collect's final snapshot):** on any throw, `collect` sends one `safe(raw)` before rethrowing. A throw from
  `safe` is swallowed, so the provider error is never masked; `onText` runs before the caller handles the error.
  T3.08 fails on 81f7c0c's collect.ts (the last snapshot lagged on the 700-char line).
- L2–L4: no code, reasons in the handoff; agreed. Contract unchanged. 0 new findings.
