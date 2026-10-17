# SPC-29 lens A r1 (PE pe-b2, 2026-10-17)

PR #41, test-only (`apps/extension/test/council.test.tsx` + handoff). I ran the file here: 20/20 green. The pass
bar (50/50 whole file, 60/60 under 6× load, 3/60 failing before) was fixed in the plan before the runs.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 1 LOW.**

## Checks
- **The wait targets the real race:** `initCouncil` calls `watch()` (which registers `runtime.onMessage`, council.ts:279)
  synchronously before it sets `loaded: true` (council.ts:307). So `loaded === true` means the panel is listening, and
  a `council.started` sent after that can't be lost. The wait isn't a sleep.
- **Per-test listener capture in `wireHost`:** a host left over from an earlier test now notifies only its own
  test's (dead) listener set, so it can't drive a later panel. This is correct and closes the cross-test path.
- **Drain:** `liveRunId` goes null only after the awaited final `put` (councilHost.ts:171-172). The earlier
  fire-and-forget turn saves were queued before it on the same store, so "no live run" means "no write left from
  that run". The `waitFor` throws with the stuck run ids, so a host that ignores `halt` fails loudly instead of
  leaking.
- No production code changed; no contract touched.

## LOW
### L1. The drain can't see a start that is still building its provider
`halt` cancels a `pending` start, but `liveRunId` is null during that window. If a test ends while
`makeProvider` hasn't resolved yet, the drain passes at once. Then the start continues (cancelled → abort →
a `stopped` record) and its final `put` can land in the next test's DB. In this file `makeProvider` is
`async () => provider` (one microtask), and `cleanup()` runs first, so the window is tiny. That's why it's LOW.
**Fix (optional, test-only):** after the `halt` loop, `await new Promise((r) => setTimeout(r, 0))` before the
`waitFor`, so any pending start reaches `live` (and so `liveRunId`) before the check. No re-review needed.
