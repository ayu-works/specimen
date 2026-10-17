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

## Fold check: lens B r1 → fbf91de (pe-8a, 2026-10-17): APPROVED, 1 optional LOW
- **H1, a miss in my r1:** I reasoned that the final cut "only truncates", but a cut inside `zentrixology` makes a
  whole-word `zentrix`. `clamp` now re-runs `safe` on the cut text, and sanitizing only removes text, so the result
  stays within `max`. Correct, and the summary and keyword cases are tested.
- **M1 and my L1:** the save error is now a toast, which outlives the card. The module-level `running` guard means a
  remounted card is busy and can't start a second run. Saves are chained in order, and `saves` swallows errors so
  the chain never breaks.
- **M2:** a vibe that finishes after a scan switch is saved by its own `scan.id` and not shown on the new scan.
  Correct.
- **Other changes:** `keywords` drops non-strings instead of falling back to the raw reply; keywords are unique
  case-insensitively; the fallback summary uses `cutText`.
- **Can the tests fail?** I ran fbf91de's tests with `vibe.ts` and `Vibe.tsx` from 7831dca: 5 of 20 T3.35 tests
  fail, and 6 of 8 T3.36 tests fail.

**L (optional). A hung model call locks the card until the panel reloads.** `running` is module state and is
cleared only when `vibe()` settles. Before, a remount reset `busy`, which gave the user a way out. Now a provider
call that never settles keeps every Vibe card busy, with no cancel, for the life of the panel. SPC-35 fixed the
known local-Gemma hang, and the BYOK adapters have network timeouts, so it's unlikely. Fix (if wanted): pass an
`AbortSignal` and add a Cancel button, or accept it, since reloading the panel recovers.
