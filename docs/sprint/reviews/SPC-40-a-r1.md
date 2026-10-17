# SPC-40 lens A r1 (PE pe-b2, 2026-10-17)

PR #44 @ d198aaa: `Vibe.tsx`, `test/vibe.test.tsx` (T3.38), TESTING.md. vibe.test.tsx: 12/12 green here.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW.**

## Checks
- **The call can't hang:** `Promise.race([vibe(..., signal), timedOut])`. The timer rejects first and then aborts, so
  the error is always the timeout text, never "aborted". `finally` clears the timer and `running` exactly once.
  A late rejection from the losing `vibe()` is absorbed by the race, so it isn't unhandled.
- **No silent writes after a timeout:** the result is read only from the race, so a late reply never reaches
  `setVibe` or `updateScan`. Test 2 drives that with a second run in between: only the second run is shown and saved,
  and the late reply arrives after it (my plan note b).
- **The tests can fail:** on main, test 1 stays "Looking…" forever. Test 3 drives the remount path through the
  module-level `running`, and test 4 checks that a fast reply leaves no stray timer.
- **Unchanged:** SPC-33's save chain, `libraryErrorText`, the toast on a failed save. The `useEffect` busy reset works
  unchanged with the raced `running`.
- The 120 s value matches the council's first-text stall. A vibe during a Gemma download times out while the download
  keeps going (client-side abort only; SPC-18 keeps a load alive when its Port disconnects), as noted in the handoff.
