# SPC-35: a worker crash during model load leaves that load pending forever

Lane B. Branch `exec/spc-35` from origin/main 11074ac (includes #31 / SPC-18).

## Plan

### Problem
`load()` in `apps/extension/src/entrypoints/offscreen/llmHost.ts` awaits `CreateWebWorkerMLCEngine(worker, …)`. That
call settles only from the worker's replies. If the worker dies (`error` / `messageerror`) or the engine is disposed
(`unload`, `delete`) while the model is loading, `crashed()` → `disposeEngine()` terminates the worker but nothing
rejects the load: `loadPromise` stays set for ever. Effects: every `load` waiter (options page, a side-panel chat's
`client.load`) waits for ever; `status` reports `loading: true` for ever; a later `load` of another model does
`await loadPromise` and hangs too; `llmBusy()` stays true, so the offscreen document never closes.

### Approach (llmHost.ts only, ~20 lines)
1. A module-level `abandonLoad: ((e: Error) => void) | null`, the load-time twin of `Job.abandon`.
2. In the load IIFE, *after* its own initial `disposeEngine()`, build a `gone` promise whose reject is
   `abandonLoad` (with `gone.catch(() => {})`), and `engine = await Promise.race([CreateWebWorkerMLCEngine(…), gone])`.
3. `disposeEngine(reason)` also calls `abandonLoad?.(new Error(reason))`. So a worker crash during load rejects with
   "The local model stopped unexpectedly. Try again." and an unload during load with "…was unloaded. Try again.".
   The existing `catch` → `disposeEngine()` and `finally` (clears `loadingId`, `loadPromise`) then run as today; the
   `finally` also clears `abandonLoad`.
4. Stale worker guard: `initProgressCallback` broadcasts only while `worker === w`, so a dead load's late progress
   can't leak into a retry's progress bar. The raced-away `CreateWebWorkerMLCEngine` result is never assigned
   (`engine` is only set by the winning race), so a late resolve of the dead engine is dropped.
5. `delete` of the model that is *loading* (`loadingId === msg.modelId`) disposes too, like a delete of the loaded
   one (today it wipes the cache under a running load). Small, same mechanism; drop it if the PE prefers.

The client (`packages/ai/src/providers/webllm.ts`) is unchanged: a load `error` event already rejects `client.load`
with a `ProviderError`. UI retry already exists in the options page (`LocalGemma.tsx`: on error it shows the
message in a `role=alert` and re-enables "Download & load"); in the side panel a chat whose `load` fails ends in an
error and the user can ask again. I'll add one UI test to pin the options retry (below); no UI code change expected.

### Failure modes
| Case | Behaviour |
|---|---|
| Worker `error`/`messageerror` during load | Load rejects (`error kind:'other'`, "stopped unexpectedly. Try again."); worker terminated; `status` → `loading:false, loaded:undefined`; `llmBusy()` false |
| `unload` / `delete` (of the loading model) during load | Same, message "unloaded. Try again." |
| Two waiters on one load (two Ports, or the same Port twice) | Both get one `error`; neither gets `ready` |
| Retry after failure | A new `load` makes a new worker, gets `progress… ready`; chat works |
| Load of *another* model queued behind the dead load | Its `await loadPromise.catch()` frees, it loads and gets `ready` (the queue is free) |
| Dead load's `CreateWebWorkerMLCEngine` resolves/rejects late, or its progress callback fires late | Ignored (race already settled; progress guarded by `worker === w`); doesn't touch the retry's engine |
| Crash event from the *old* worker after a retry started | Ignored (`worker === w` guard, unchanged) |
| Crash *after* load finished | Unchanged (#31 path: running chat abandoned, engine disposed) |
| `disposeEngine()` at the start of a load | Must not reject that same load: `abandonLoad` is set only after it |
| Errors during cleanup (`unload()` / `terminate()` throw) | Already guarded in `disposeEngine`; the reject runs first |
| Port waiting on the load disconnects first | `send` swallows the dead post (unchanged); other waiters still get the error |

Atomicity/drift: one load at a time; `abandonLoad` lives and dies with `loadPromise` (set in the IIFE, cleared in
its `finally`), so "is a load pending" stays one fact (`loadPromise`).

### Tests (T3.11, `apps/extension/test/ai/llmHost.test.ts`; fake engine, fake Worker, no real model)
Fake `CreateWebWorkerMLCEngine` gets a "never settles" mode (gate that is never resolved), plus a late-resolve
option. Each new test fails on 11074ac (times out waiting for the error).
1. **Crash during load:** load hangs, `state.worker.fire('error')` → `error` (message "stopped unexpectedly"), no
   `ready`; `status` → `loading:false, loaded:undefined`; `host.llmBusy()` false once the Port disconnects. Also with
   `messageerror`.
2. **Dispose during load:** `unload` from another Port during a hung load → load `error` "unloaded"; and `delete` of
   the loading model → load `error` + `deleted`.
3. **Two waiters on one load:** ports a and b both `load` the same model, crash → each gets exactly one `error`,
   neither gets `ready`.
4. **Retry after failure:** crash during load, then load again (load gate open) → `ready`, a chat completes `done`;
   the dead load's late resolve and late progress after the retry don't reach the Ports or change `status`.
5. **Queue freed:** a load of another model sent while the first hangs → crash → the second gets `ready`.
6. **UI retry** (`test/options.test.tsx` or a small new `test/localGemma.test.tsx`, mocked `WebLLMClient`): the
   load rejects → the alert shows the message and "Download & load" is enabled; clicking it calls `load` again and
   shows "Ready".
Existing T3.11 tests and the council tests (`test/councilHost.test.ts`, `test/council.test.tsx`) stay green unchanged.
`docs/TESTING.md` T3.11 row gets "a crash or dispose during load rejects every waiter and a retry works" appended.

### Check
`pnpm gate` green. Manual (owner): Settings → Local Gemma → "Download & load" (pick a model that isn't cached so the
load takes a while). While it shows "Downloading N%", open `chrome://inspect/#other`, inspect the extension's
`offscreen.html`, and in its console run
`chrome.runtime.connect({ name: 'llm' }).postMessage({ type: 'unload' })` → within a second the card shows
"Something went wrong" with "The local model was unloaded. Try again." and "Download & load" is clickable (before
this fix it stayed on "Downloading" for ever). Click it → it resumes and ends on "Ready". (A real worker crash can't
be triggered by hand; it's the same code path and is unit-tested.)

## Done
- PE (pe-8a) APPROVED 2026-10-17, step 5 in; build notes on the Linear ticket, all four followed.
- Tests first: the 6 planned T3.11 host tests failed on 11074ac (unchanged host) before any fix.
- `llmHost.ts`: `abandonLoad`, set right after the load's own `disposeEngine()`, cleared in `finally`, fired by
  `disposeEngine(reason)`. `CreateWebWorkerMLCEngine(w, …)` raced against it. Progress guarded by `worker === w`
  (`lastP` and broadcast). `delete` also disposes when `loadingId === modelId`.
- **Found while building (not in the plan):** two `load`s sent together both passed the `loadPromise` check before
  `await hasGpu()`, so two workers started and the second's `disposeEngine()` killed the first. In Chrome that left
  the first waiter pending on a terminated worker; the fake hid it (its `terminate()` does nothing). With the
  abandon in place the existing "abort or disconnect during a load" test failed, which exposed it. Fix: re-check
  after the await (`if (loadPromise || loaded) return load(modelId)`). New test "two loads sent together share one
  worker and both get ready".
- Proof against 11074ac (host file swapped back, tests run): all 7 new T3.11 tests fail. With only the `worker === w`
  guard removed: only the retry test fails.
- UI: `test/localGemma.test.tsx` (mocked `WebLLMClient`): failed load → alert + "Something went wrong", button
  enabled; click → "Ready". No UI code change was needed.
- `docs/TESTING.md` T3.11 row extended (no new IDs). Council tests unchanged and green. `pnpm gate` green
  (gitleaks skipped locally, not installed; the one Biome warning is `lib/chatScrub.ts`, already on main).

## Next
- PR open, waiting for reviews (PE lens A + a lens B reviewer). Fold findings in new commits.

## How to resume
Read this file, then `llmHost.ts` (`load`, `disposeEngine`, `delete`) and the tests at the end of
`test/ai/llmHost.test.ts`. Branch `exec/spc-35`.
