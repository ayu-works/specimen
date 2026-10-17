# SPC-29: flaky T3.33 "a run started from another window" (council.test.tsx)

Lane C · branch `exec/spc-29` from origin/main b01ea77 · Owns `apps/extension/test/council.test.tsx` · PE: pe-b2 (was pe-4d).

## Plan (APPROVED by pe-4d, 2026-10-17)
PE notes: put before/after numbers in the PR; the drain's waitFor has an explicit timeout and names the stuck
runId; keep `notify` bound per test and say so in the T3.33 comment. All three are done.

### Pass bar (set before the fix)
- Vitest 5 has no `--repeat` flag, so the repeat is a shell loop over the whole file (it keeps the real test order,
  so cross-test state counts). Bar: **50/50 whole-file runs** green
  (`for i in $(seq 50); do npx vitest run test/council.test.tsx || echo FAIL; done`), **plus 60/60 runs of the
  single test under 6× parallel load**. Load is what reproduces the flake locally (baseline below). Both results go
  in the PR. CI: no flake over the next 10 runs (the orchestrator watches this after merge).

### Did #30 (ef29d3e) already fix it?
Partly, and it was a different trigger. The CI flake on PR #28 (run 38642639549 attempt 1, 2026-10-14 21:46Z) came
**before** #30 merged (22:32Z), so it had no `restorePanel`. #30 removed one source of timing jitter (the restore's
Library reads, which made the failure 1 in 8 on its branch). It did not remove the race below, which still
reproduces on b01ea77.

### Baseline (b01ea77, before any change)
- Whole file, 20 runs in a row, idle machine: 20/20 pass.
- Single test, 6 loops × 10 in parallel: **3/60 fail**, all `Unable to find [data-testid="council-running"]` after
  about 1.09 s. That is the CI signature (1016 ms, line 400 then, line 430 now).
- Probe (a temporary `console.log` in `wireHost`'s `notify`, now reverted), rerun with load: **both failing runs
  logged `council.started` with `runtimeListeners.size === 0`.**

### Root cause
`council-setup` is committed in the same render that turns `council` true, but `initCouncil()` (which calls
`watch()` and registers the `chrome.runtime.onMessage` listener) runs in that render's passive `useEffect`, which
React flushes on a later macrotask. `findByTestId('council-setup')` resolves on the DOM mutation, so the test can
post the other window's `start` before the effect has run. Under load the host reaches
`notify({type:'council.started'})` first, and the notice goes to no listener. The test stubs `hasOffscreen → false`,
so `initCouncil` never attaches either. The panel only hears `council.finished` (`!port` → `refresh()`), so it
jumps straight to the report and never shows `council-running`.

**This is not a product race.** In the extension, the other window's panel calls `ensure()` (which creates the
offscreen document) before it posts `start`. A panel that misses the notice still reaches
`if (await councilIo.hasOffscreen()) attach(...)` in `initCouncil`, and the real `hasOffscreen()` is true by then,
so it attaches and gets the running snapshot. The gap only exists because the test pins `hasOffscreen` to false
for the whole test. The fix is test-only; no `src/` change.

### Change (test-only, `apps/extension/test/council.test.tsx`)
1. **Wait for the real state transition.** After `council-setup` appears, and before the other window starts,
   `await waitFor(() => expect(useCouncil.getState().loaded).toBe(true))`. `loaded` is set at the end of
   `initCouncil`, after `watch()` has registered the listener, so it means "this panel is listening". This matches
   the test's premise: a panel that opened earlier, then a run starts elsewhere.
2. **A generous timeout on the transition:** `findByTestId('council-running', {}, { timeout: 5_000 })`. Today it uses
   the default 1 s; the report wait stays at 10 s.
3. **Isolation between tests (the shared-state check).** I checked:
   - The IndexedDB reset (`_resetCouncilDb` in both before/after) and `_resetCouncil()` are sound.
   - **But** hosts from earlier tests are never stopped. Their `notify` reads the module-level `runtimeListeners`
     at call time, so an old host's `council.finished` reaches the *next* test's panel. Its later `putRun` writes
     can also land in the next test's fresh `specimen-council` DB (Dexie reopens lazily). For example, the "reattach
     … crash" test leaves a mock run going, and T3.32 "slow host" ends at `council-running`.
   - Fix: `wireHost` keeps each host in a `hosts[]` list and binds `notify` to that test's own listener set
     (`const listeners = runtimeListeners`). `afterEach` calls `host.halt(Date.now())` on each host, then waits
     until `liveRunId === null` (its final `put` is done) **before** `_resetCouncilDb()`, so no write crosses into
     the next test.
4. Leave `test/helpers/chrome.ts` alone (SPC-21 owns it). No change to `src/`.

### Tests
- No new test ID: this hardens the existing T3.33 test. The failure path is "the start comes before the panel
  listens". Step 1 removes that race from the test's premise. A panel that misses the notice is already covered
  by product code (`hasOffscreen` → attach) and by the T3.32 reopen tests.
- Check after the fix: the pass bar above (whole-file 50/50, plus the loaded 60/60 single-test run that fails
  3/60 today), then `pnpm gate`.

### Failure modes considered
- **Drain hangs:** a host stuck in `pending` (provider being built) has no `liveRunId`, so it won't block. A run
  that ignores abort would hit the `waitFor` timeout (5 s) and fail `afterEach` loudly. That is better than silent
  bleed. All hosts here use the mock provider, which honours the signal.
- **The halt itself writes** (a final `stopped` put). That is exactly why the drain waits for `liveRunId === null`
  before the DB reset.
- **The "reattach … crash" test** sets `dead = true` so its `put` is a no-op. Halting it is harmless.
- **Masking a real bug:** the waits target real state (`loaded`, the host's `liveRunId`), not sleeps. The
  `council-running` assertion stays, so a panel that never shows the running run still fails.
- **Concurrency with other lanes:** test-only, one file I own. `helpers/chrome.ts` is untouched.

## Done
- Plan, baseline repro, root-cause probe (reverted).
- Fix in `test/council.test.tsx`: wait for `useCouncil.loaded`; `council-running` 5 s; `hosts[]` with a per-test
  `notify` listener set; `afterEach` halts every host and waits (5 s, naming any stuck runId) for its final write.
- After the fix: single test under 6× load **60/60** (was 3/60 failing); whole file 50× sequential **50/50**; `pnpm gate` green.

## Next
- PR open → comment on SPC-29 → message specimen-75 → fold PE lens A (pe-b2) + lens B reviews.

## How to resume
Read this file; `git log origin/main..exec/spc-29`. Load loop: the scratchpad `loop.sh` is gone with the session,
so re-create it as `for i in $(seq N); do npx vitest run test/council.test.tsx -t "another window"; done`, run 6 in
parallel from `apps/extension`.
