# SPC-40: a vibe() call that never settles keeps the Library card busy

Status: **plan APPROVED by pe-b2 (2026-10-17); built, gate run, PR opened.** Executor session: spc-40-3c. Branch `exec/spc-40` from `origin/main` b01ea77.

## Plan

### Approach
All in `apps/extension/src/entrypoints/sidepanel/views/Inspect/Vibe.tsx` (`index.tsx` not needed).

1. `export const VIBE_TIMEOUT_MS = 120_000` (same as the council's first-text stall, `DEFAULT_STALL_MS.first`:
   long enough for local Gemma to warm up from cached weights and for the image → text-only fallback inside `vibe()`).
2. In `run()`: an `AbortController` per run, passed as `vibe()`'s 4th arg (`signal`, already supported and handed to
   the provider's `chat`). A timer rejects a `timedOut` promise with
   `Error('The model took too long to describe the vibe. Try again.')` and then aborts the controller.
   The run awaits `Promise.race([call, timedOut])`, not `call`.
3. `running` (module state, read by a remounted card) becomes the raced promise (`.then(noop, noop)`), so a remounted
   card also goes idle at the timeout. `finally`: `clearTimeout`, `running = null`, `setBusy(false)` (as now).
4. On the timeout: `setErr(msg)` when `shown()` (as for any vibe error) **and** `toast(msg)`, because the card may
   have unmounted (tab switch) during the 2 minutes and the inline line would never be seen. Other vibe errors keep
   today's inline-only behaviour (unchanged scope).
5. A late reply: the run only reads the raced result, so a `call` that resolves after the timeout is dropped: no
   `setVibe`, no note, no `updateScan`. Its late rejection is already handled by the race (no unhandled rejection).
6. SPC-33 (#35) save path (`saves` chain, `libraryErrorText`, toast + `saveErr`) is untouched; it only runs after a
   successful, in-time reply.

### Failure modes
- **Provider ignores the signal** (the ticket's case): the race still settles at the timeout; the stuck promise is
  left to the GC. Test drives exactly this.
- **Provider honours the signal**: abort comes after the timeout rejection, so the race has already settled with the
  timeout message (not "aborted").
- **Late reply after the timeout**: dropped (no store write, no Library write). Tested.
- **Late reply after a new run started**: the old run's result is never read, and `latestRun` still guards display.
- **Remount during the hang**: remounted card shows busy, goes idle at the timeout (no second run while busy). Tested.
- **Unmount during the hang**: timer still fires, `running` cleared, toast tells the user; no setState-on-unmounted
  issue beyond what React already tolerates (same as today's path).
- **Fast reply**: timer cleared in `finally`; advancing past the timeout shows no toast/error. Tested.
- **Concurrency / two copies of a fact**: `running` is still the single "in flight" flag; it is cleared exactly once
  per run in `finally`. Idempotency/atomicity: no new persisted state.
- **Gemma still loading/downloading** (pe-b2): Gemma's `chat` waits on `client.load`, so a vibe started during a
  download runs into the timeout. The abort only fails the client side; SPC-18 keeps the load alive when its Port
  disconnects, so the download keeps going. Manual step in the PR.
- **Timeout too short for a slow local model**: 120 s matches the council; the user can just retry. Noted, not tuned.

### Tests (`apps/extension/test/vibe.test.tsx`, new ID **T3.38**: T3.37 is taken by open #spc-37; PE please confirm no
other open PR claims T3.38). Fake timers (`vi.useFakeTimers({ shouldAdvanceTime: true })` + `advanceTimersByTimeAsync`),
a provider whose `chat` never yields, no network.
1. A never-settling vibe: before the timeout the button is busy; after `VIBE_TIMEOUT_MS` it is enabled ("Describe the
   vibe"), the error line shows the timeout message, a toast was sent, `scan.vibe` unset, and the provider's signal is
   aborted.
2. A late reply after the timeout (gated provider that ignores the signal, opened after the timeout): no vibe shown,
   store unchanged, `updateScan` never called.
3. A card remounted during the hang shows busy, then idle at the timeout.
4. A reply in time: shown and saved; advancing past the timeout adds no error and no toast.
Plus a T3.38 row in `docs/TESTING.md`.

### Files
`views/Inspect/Vibe.tsx`, `apps/extension/test/vibe.test.tsx`, `docs/TESTING.md` (one row), this handoff.
Not touched: `sidepanel/store.ts` (SPC-44), `council.test.tsx` (#41), `test/helpers/chrome.ts` (#40).

### Check
`pnpm gate` green.

## Done
- `Vibe.tsx`: `VIBE_TIMEOUT_MS`/`VIBE_TIMEOUT_TEXT`, AbortController + race, toast + inline error on timeout.
- `vibe.test.tsx`: four T3.38 tests (fake `setTimeout` only: faking all timers breaks Dexie's transactions). Test 2
  also starts a second run after the timeout (pe-b2 note b). All four fail against the old `Vibe.tsx`.
- `docs/TESTING.md`: T3.38 row.

## Lens B r1 fold (2026-10-17, `docs/sprint/reviews/SPC-40-b-r1.md`)
- **M1** message now names every cause: "No answer from the model (it may be busy or still loading). Try again in a
  moment." (`VIBE_TIMEOUT_TEXT`).
- **M2** stall timer like the council instead of a total cap: `VIBE_TIMEOUT_MS` 120 s to the first text, then
  `VIBE_GAP_MS` 30 s between pieces. A thin wrapper around `provider.chat` in `Vibe.tsx` re-arms the timer on each
  delta (`vibe()` and `packages/ai` untouched; `DEFAULT_STALL_MS` isn't exported, so the values are mirrored, not
  imported). A `settled` flag stops a late reply's text from re-arming a finished run. Tests: slow but steady text
  over 150 s is shown; text that stops mid-reply times out after the gap.
- **L1** the latest run's error is module state (`lastErr`, by scan id), so a card remounted after a tab switch shows it.
- **L2** the timeout is toasted only when no card is mounted or the scan isn't shown; a visible card shows the line only.
- **L3** test for a provider that honours the abort (shows the timeout text, not "Stopped"); test 1 margin widened to
  `VIBE_TIMEOUT_MS / 2`. Note: swapping `fail`/`abort` doesn't change the outcome (the provider's abort error reaches
  `vibe()` asynchronously), so the comment says that instead of claiming the order matters.
- Mutation-checked: removing the re-arm, the toast condition or the remount `setErr(lastErr)` each fails a T3.38 test.

## Next / how to resume
- Lens A r1 (pe-b2): APPROVED, 0 findings (`docs/sprint/reviews/SPC-40-a-r1.md`). Lens B r1 folded (above); pe-b2 fold check at 5701c1f APPROVED (2026-10-17). Reviews done; waiting on the owner's "merge all"; never merge.
- **SPC-55 lens B M1 fold (spc-40-ca, 2026-10-17):** `watched.chat` re-arms `VIBE_TIMEOUT_MS` at the start of each call, so a retry inside `vibe()` gets the full first-text wait, not the 30 s gap left over; T3.38 test: call 1 streams then fails, call 2's first text at 40 s, run succeeds (fails without the line). Awaiting pe-b2 fold check.
