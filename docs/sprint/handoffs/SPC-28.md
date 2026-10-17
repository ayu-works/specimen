# SPC-28 handoff: waitForTabLoad can miss the tab's 'complete' event

Executor session `spc-28-10`, branch `exec/spc-28` (from origin/main b01ea77), lane A. PE: `pe-4d`.

## Plan (APPROVED by pe-4d, 2026-10-17, with build notes 1-4 below)

### What is actually wrong
`waitForTabLoad` (`apps/extension/src/lib/scanFlow.ts:85`) already adds `onUpdated`/`onRemoved` before calling
`tabs.get`, so the textbook "check, then listen" race is not the bug. The SPC-25 log (handoff SPC-25.md:128) showed
the real failure: `tabs.get` answered `loading`, and the `status: 'complete'` `onUpdated` never reached the
listener. `addListener` in an extension page registers with the browser over IPC asynchronously; an event the browser
dispatches before that registration lands is never delivered, and the single `tabs.get` snapshot can be older than
the event. One check can't close that gap; checking again later does. Also: a `tabs.get` failure is swallowed
(`.catch(() => {})`), so a tab that's already gone waits the full 30 s.

### Approach (scanFlow.ts only, plus removing the workaround)
1. `waitForTabLoad(id, timeoutMs = 30000, pollMs = 500)`:
   - Register `onUpdated` + `onRemoved` first (unchanged). `onUpdated` also accepts the `tab` argument's
     `status === 'complete'`, not just `info.status`.
   - `check()` = `tabs.get(id)`: `complete` → resolve. A rejection matching `No tab with id` → reject
     "The tab was closed" (already mapped by `friendlyScanError`). Any other rejection → ignore, the next check retries.
   - Run `check()` right after registering, then every `pollMs` until settled (the re-check). The poll is the backstop
     for an event that was dispatched before the registration took effect.
   - Bounded timeout (still 30 s default) rejects with `The page took too long to load` .
   - One `settled` flag: `done()` is idempotent; it clears the timer and the interval and removes both listeners,
     so late events or late `tabs.get` answers after settling do nothing.
2. `friendlyScanError`: `/took too long to load/` → "The page took too long to load. Check the address or your
   connection and try again." (Rescan-by-URL shows this; mobile capture shows its own "Mobile capture skipped: …"
   with the raw message in `extras.ts`, which I don't touch.)
3. Remove the SPC-25 workaround in `apps/extension/src/lib/captureFlow.ts:221-223`: go back to
   `if (ownWindow) await rememberMobileWindow(win.id as number);` and drop the comment. (captureFlow.ts is not held
   by an active lane per plan.md; orchestrator, shout if SPC-29/SPC-21 own it.)
4. Keep SPC-20's changes untouched (`saveError`, `friendlyScanError` branches, css.fetch skipped contract).

### Files
- `apps/extension/src/lib/scanFlow.ts` (waitForTabLoad, friendlyScanError line)
- `apps/extension/src/lib/captureFlow.ts` (the `void` → `await`, comment)
- `apps/extension/test/waitForTabLoad.test.ts` (new; its own local `chrome.tabs` stub via `vi.stubGlobal`;
  `test/helpers/chrome.ts` is NOT edited, SPC-21 holds it)
- `docs/TESTING.md`: one new row **T5.12** (U) "waitForTabLoad resolves whether `complete` arrives before, during
  or after the listener attaches, or is lost (re-check); rejects with a clear error on timeout or a closed tab;
  cleans up". **PE: OK to take T5.12?**
- this handoff

### Tests (T5.12, fake timers, no real URLs)
1. Before: `tabs.get` → `complete` immediately → resolves; listeners removed.
2. During: `onUpdated` fires `complete` synchronously inside `addListener`'s turn (before `tabs.get` answers, which
   answers a stale `loading`) → resolves once.
3. Lost event (the SPC-25 case): the `complete` event is never delivered; `tabs.get` says `loading` first, `complete`
   on a later call → resolves after one poll interval. Fails on current main (hangs to the timeout).
4. After: `tabs.get` `loading`, then `onUpdated(complete)` → resolves.
5. Another tab's `complete` and a non-complete status for this tab are ignored.
6. Timeout: never completes → rejects "The page took too long to load"; afterwards no listener left, no further
   `tabs.get` calls when time advances (interval cleared).
7. Closed: `onRemoved(id)` → rejects "The tab was closed"; `tabs.get` rejecting `No tab with id: 5` → same rejection
   immediately; a transient other rejection is retried and then resolves.
8. `friendlyScanError('The page took too long to load')` → the new sentence.
9. T5.03 under an artificial delay (manual, recorded here, not committed): temporarily add `await sleep(1000)` between
   `windows.create` and `waitForTabLoad` in captureFlow, `pnpm build && pnpm e2e -g T5.03`, must pass well inside
   its 30 s; then revert. Plus the full `pnpm gate` with the workaround removed (await restored).

### Failure modes
- **Double settle** (event and poll both see complete; timeout racing a late answer): `settled` flag; resolve/reject
  once; tested in 2 and 6.
- **Leaks / cleanup**: every exit path goes through `done()`, which removes both listeners and clears both timers; a
  `tabs.get` answer arriving after settle is ignored. Test 6 asserts no calls after settle.
- **Tab closed before or during the wait**: `onRemoved` or `tabs.get` "No tab with id" → fast clear rejection, not a
  30 s hang. Other `tabs.get` errors are treated as transient (retry), so a flaky read can't fail a good load.
- **Wrong 'complete'**: a tab can go complete → loading → complete (redirect, `rescanUrl` 800 ms settle covers late
  content). We resolve on the first `complete`, same as today: no behaviour change there.
- **Concurrency**: each call has its own closures/timers; two waits on different tabs don't interfere (filter by id).
- **Load cost**: one `tabs.get` per 500 ms for at most 30 s; negligible.
- **Removing the workaround**: `rememberMobileWindow` is awaited again; with the poll, the delay it adds no longer
  matters; T5.03 + the delay check prove it. The recovery record ordering (set then clear) becomes strictly ordered.

## PE build notes (folded)
1. about:blank is not loaded: `tabLoaded()` needs `complete`, no `pendingUrl`, and `url !== 'about:blank'`.
   **Deviation, flagged to the PE:** an absent `url` still counts as loaded (Chrome hides `url` without host access,
   and the mobile tests' popup stub has none); treating it as blank would hang those to the timeout. An `onUpdated`
   without the `tab` argument trusts the event.
2. Re-check is chained (`setTimeout` after each answer), not `setInterval`. Tested ("a slow read is never overlapped").
3. T5.03 delay run recorded below.
4. captureFlow.ts claimed with the orchestrator (message sent 2026-10-17).

## Done
- Read brief, setup, plan (Resume 2026-10-17), SPC-28 (no comments), SPC-25 handoff notes. `pnpm i`.
- `scanFlow.ts`: `waitForTabLoad` re-reads the tab (chained, 500 ms) until loaded, fast "The tab was closed" on
  `No tab with id`, idempotent `done()`; `friendlyScanError` maps the timeout. `captureFlow.ts`: workaround removed
  (`await rememberMobileWindow`; `remember()` never throws, so no leak before the `try`).
- `test/waitForTabLoad.test.ts`: 11 × T5.12, local `vi.stubGlobal('chrome')` stub, fake timers, no URLs fetched.
  Against main's `scanFlow.ts` 6 of 11 fail, including "complete event lost (SPC-25)" (hangs to the timeout).
  Note: the "during" case fires the event in a microtask (Chrome events are never synchronous inside `addListener`).
- `docs/TESTING.md`: T5.12 row (PE OK).
- Test 9, T5.03 under an artificial delay: temporarily added `await sleep(1000)` right after
  `rememberMobileWindow` in `captureMobile`, then `pnpm build && pnpm e2e -g "T5.03"` → **1 passed (4.4 s)**.
  Same delay with main's old `waitForTabLoad`: **also passed (4.4 s)** on this machine, so the SPC-25 hang did not
  reproduce here with a 1 s delay (it is timing-dependent); the unit test is what drives the lost-event path. Delay
  reverted (`grep TEMP` = 0).
- `pnpm gate` green 2026-10-17 (gitleaks not installed locally; CI runs it). check-ids: 113 IDs present.

- PR #39 opened; link commented on SPC-28. Lens A r1 (pe-4d, `docs/sprint/reviews/SPC-28-a-r1.md`): APPROVED, 0 findings.
  Its note (rescanUrl leaves its tab open on failure) is existing behaviour; filed by the orchestrator as SPC-45 (out of scope for #39).

- Lens B r1 (`docs/sprint/reviews/SPC-28-b-r1.md`, 0C/0H/2M/3L), folded:
  - **M1** (the about:blank guard was a no-op: without `tabs`, Chrome hides about:blank's url): callers pass the
    target `url`. If `permissions.contains` says we can see its origin, or a read has shown a `pendingUrl`/real url,
    a hidden url means still blank. Otherwise (url always hidden) `complete` is trusted as on main. Events are
    ignored until that answer, and the read right after it covers them. The mobile test rig's popup tab now has
    `url: PAGE`, since the rig reports host access and real Chrome then shows the url.
  - **M2** T5.03 `--repeat-each=20` (2026-10-17, local macOS): `pnpm build && pnpm e2e -g "T5.03" --repeat-each=20`
    → **20 passed** on the M1 fold; with a temporary `await sleep(1000)` after `rememberMobileWindow` → **20 passed**
    (reverted, `grep TEMP` = 0); after the L1 fold → **20 passed**. Not CI or CPU-throttled: the PR's CI run is the
    next evidence.
  - **L1** folded: after a `pendingUrl` was seen, 4 reads (~2 s) of `complete` that still aren't loaded → "The
    address did not open a page" → "This address didn't open a page (it may be a download). Check the link and try
    again." A blank tab before any pending navigation still waits (it's the M1 case, not abandoned).
  - **L2 out of scope** (it changes what the timeout means: resolve on a committed but still-loading page). It's
    pre-existing; the orchestrator added it to SPC-45.
  - **L3** folded: the "during" test is now "event and read race" (the event lands while the read is in flight,
    then the read answers a stale `loading`), plus a test for a `complete` event whose tab still has `pendingUrl`.
  - T5.12 had 17 tests after this fold; 10 of the 14 before L1 failed on main's `scanFlow.ts`.

- Lens A r2 (pe-b2, `docs/sprint/reviews/SPC-28-a-r2.md`, 1 MEDIUM) folded: the L1 reject wrongly hit a redirect to
  an origin without host access (a.com → www.a.com), which read as "didn't open a page" instead of SITE_ACCESS. Now,
  after `ABANDONED_READS` the wait **resolves** and `scanTab` reports the truth (about:blank → "can only scan
  websites", an origin without access → SITE_ACCESS). The "did not open a page" `friendlyScanError` branch is dropped.
  New test for the redirect; T5.12 now has 18 tests. Gate green.

## Next
- Re-check by pe-b2 → #39 done; then idle (orchestrator's instruction). Owner decides the merge.

## How to resume
Read this file; branch `exec/spc-28`; plan above is the contract once approved.
