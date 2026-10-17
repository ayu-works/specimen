# SPC-29 lens B r1 (fresh second reviewer, 2026-10-17)

PR #41 at the worktree's current state (e0ea54b plus the uncommitted L1 fold: `setTimeout(0)` before the drain).
Test-only: `apps/extension/test/council.test.tsx` + handoff. No `src/` change.

**Verdict: APPROVE. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 3 LOW.**

## What I checked and ran
- **Ran here:** whole file once, 20/20 in 13.0 s. T3.33 "another window" **30/30 under 6× parallel load**
  (6 loops × 5), the setup that failed 3/60 before the fix.
- **Root cause is real, not a hidden timeout.** The executor's probe logged `council.started` with
  `runtimeListeners.size === 0` in both failing runs. That matches the code: `watch()` registers
  `runtime.onMessage` inside `initCouncil` (council.ts:296), which App calls from a passive effect
  (App.tsx:114) after an async flag read. `findByTestId('council-setup')` resolves on the DOM mutation, before
  that effect runs. The old failure was "running never shows" (the panel only hears `council.finished` →
  `refresh()` → report), not "running shows late". So the fix is the `loaded` wait, and the longer timeout is
  not what makes it pass (see L2).
- **Shared state between tests:** `_resetCouncilDb` runs before and after each test; `_resetCouncil` drops the
  Port, clears the attach timer and removes the listeners. The real cross-test leak was the un-halted hosts
  (their `notify` read the module-level `runtimeListeners` at call time, and their writes could land in the
  next DB). The per-test listener capture and the halt-and-drain close both. No fake timers in this file
  (`useFakeTimers` is only in mobileCapture.test.tsx, a separate worker), so the drain's `waitFor` can't hang on
  frozen timers.
- **Could the test pass with the product broken?** If the `council.started` → `attach(null)` path broke, the
  panel would again only hear `council.finished` and skip `council-running`: the test still fails. Nothing
  else puts a running record in front of this panel (`loaded` is already true, the DB has no running record when
  `initCouncil` read it). So the assertion still guards the behaviour.
- **Is it a product race (two windows)?** No. `watch()` is the first synchronous step of `initCouncil`, and
  `hasOffscreen()` is checked after it. A panel either registered the listener before the notice (hears it) or
  reaches `hasOffscreen()` after the other window's `ensure()` made the document (true → attach → the host's
  snapshot). The "missed notice, attach anyway" path is covered by T3.32 "reopen with nothing stored (writes
  failing)": `hasOffscreen` true, no stored record, `attach(null)` gets the live run from the host. I agree with the
  handoff.
- **Other council tests with the same pattern:** none rely on the runtime notice. The others start the run from
  this panel (Port path, `startCouncil` → `openPort`), or seed the DB and reattach. The settings-change loop test
  calls `wireHost` twice; both hosts go in `hosts[]` and are drained.
- **Gate cost:** for a test with no live run, the drain is one `setTimeout(0)` plus one synchronous `waitFor`
  check. Only the "host dies" test ends with a live run; the mock honours the abort, and that test took 407 ms
  here. The two 4.6 s tests run to `council-report`, so their drain does nothing. No measurable slowdown.

## LOW

### L1. The wait checks a stand-in (`loaded`), not the thing the race is about (the listener)
`loaded` means "listening" only because `initCouncil` happens to call `watch()` before it sets `loaded: true`.
`_resetCouncil` doesn't cancel an `initCouncil`, `refresh()` or `interrupt()` that is still awaiting.
**Scenario:** someone refactors `initCouncil` so it sets `loaded` before `watch()`, or makes `watch()` lazy. Or a
stale `initCouncil` from the previous test resolves after this test's `beforeEach` reset and writes
`loaded: true`. Either way the wait passes with no listener, and the 3/60 flake comes back with nothing to
explain it. Today the previous test ("host dies") ends settled, so the stale case is unlikely.
**Fix (test-only):** wait on the premise directly. Either replace the wait or add to it:
`await waitFor(() => expect(runtimeListeners.size).toBeGreaterThan(0));`. Keep the comment.

### L2. The 5 s `council-running` timeout isn't part of the fix
The flake was "never shows", which a longer timeout can't fix, and the snapshot reaches the panel through
microtasks, long before the ≥ 500 ms run ends. The 5 s only makes a real failure take 5 s instead of 1 s, and it
reads as though a timeout fixed the flake.
**Fix:** drop it (back to the default), or keep it and say in the PR that it is headroom, not the fix. Either is
fine.

### L3. The drain relies on `halt(Date.now())` covering every run
`halt(at)` aborts only when `live.resolvedAt <= at`.
**Scenario:** a future test sends a `start` with `resolvedAt` in the future (as T3.33 does with `Date.now()`,
a later test could add an offset), or injects `now`. That run isn't halted. The drain then waits for it to finish
on its own (slower), or fails after 5 s with "still running after halt", which blames the wrong thing.
**Fix (test-only):** `h.halt(Number.POSITIVE_INFINITY)` in `afterEach`. The host is thrown away after the test,
so a permanent `lastHaltAt = Infinity` doesn't matter.

## Not findings
- The lens A L1 fold (`setTimeout(0)` before the drain) is correct: `makeProvider` is one microtask here, so a
  pending start reaches `live` within that macrotask.
- CI: keep the planned 10-run watch after merge. The local load repro is the stronger evidence, but CI has a
  different scheduler.
