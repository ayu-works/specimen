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

## Next / how to resume
- Lens A r1 (pe-b2): APPROVED, 0 findings (`docs/sprint/reviews/SPC-40-a-r1.md`). Waiting on lens B; fold its findings; never merge.
