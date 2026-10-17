# SPC-33 lens A r1: PR #35 @ 7364150 (pe-8a, 2026-10-17)

**Verdict: APPROVED.** 0 CRITICAL / 0 HIGH / 0 MEDIUM / 1 LOW (optional).

## Checked
- **`clamp` in vibe.ts.**
  - Only `cutText(text, 2 × max)` goes through the sanitizer.
  - When that pre-cut applied, the trailing `\S*` is dropped. The split word sits at the end of `pre`, and the
    sanitizer only removes text, so it is still at the end and goes; a brand cut to "Zen…" can't survive. The
    final `cutText(…, max)` runs on text that was sanitized whole, so it only truncates and never exposes anything.
  - Fail-closed is kept: `safe` → `''` → `VIBE_FILTERED`.
  - All numbers come from `BOUNDS`. The output passes `DesignScanSchema` (asserted against the schema, not
    literals), so the bounds can't drift.
- **Keywords.** The raw list is pre-sliced (4 × 8), each keyword is clamped, empties are dropped, *then* the list is
  sliced to 8 (my build note 1). An over-long one-word keyword ends empty and is dropped, not cut: fail-closed.
- **Vibe.tsx.**
  - The save is awaited in its own `try` after `setVibe`, so a failed save never reads as a failed vibe.
  - The message uses `libraryErrorText` and has `role=alert`.
  - The run counter and store-scan-id guard drop a stale vibe result, so a vibe can't be put on the wrong scan, an
    issue that existed before. They also drop a stale save error. `busy` is held through the save and cleared
    only by the latest run.
  - The scan id is not cut (build note 4).
- **Can the tests fail?** I copied both test files into the PE worktree at origin/main de35272.
  - `vibe.test.ts`: 4 of the new T3.35 tests fail.
  - `vibe.test.tsx`: the "failed write" test and the real-`updateScan` integration test fail (build note 3: the
    looping vibe is rejected without the clamp).
  - The stale-scan test can't fail on main, which shows nothing at all, so I checked it by mutation: with the PR's
    Vibe.tsx and the `current()` and `scanId` guards removed, it fails.
- The tests that pass on main (brand-emptied keywords, pre-cut brand split, non-JSON loop, all-brand summary)
  guard the new code paths, so that's fine.

## LOW
### L1. A save error is lost if the Inspect view unmounts during the save
`saveErr` is local state of `VibeCard`. That card unmounts when the user switches the top tab away from Inspect
(or `scan` goes null). A save that rejects after that sets state on an unmounted component, so the vibe is in the
store and the prompt, and nothing ever says it wasn't saved. The window is one IndexedDB write (milliseconds), so
it's unlikely. Fix (if wanted): keep the save error in the store, keyed by scan id (like the scan's `saveError`
from #33), or accept it.
