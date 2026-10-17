# SPC-35 lens A r1: PR #34 @ ccae91c (pe-8a, 2026-10-17)

**Verdict: APPROVED.** 0 CRITICAL / 0 HIGH / 0 MEDIUM / 2 LOW (both optional).

## Checked
- **The load is raced against `gone`.** `abandonLoad` is set synchronously after the IIFE's first `disposeEngine()`
  and before any await, so that dispose can't reject its own load. `disposeEngine(reason)` fires it first. The
  existing catch → `disposeEngine()` → `finally` then clears `abandonLoad`, `loadingId` and `loadPromise`. The
  second `abandonLoad` call from the catch is a no-op on a settled promise. A late resolve of the dead
  `CreateWebWorkerMLCEngine` is never assigned. Worker events are macrotasks, so none can land between the race
  settling and `engine = …`.
- **Progress guard.** `worker !== w` drops both `lastP` and the broadcast of a dead load. The executor showed that
  removing it fails only the retry test.
- **Unplanned race fix** (re-check after `await hasGpu()`). Two loads sent together both passed the `loadPromise`
  check, and the second's `disposeEngine()` killed the first worker. In Chrome the first waiter then hung on a
  terminated worker. The re-check `if (loadPromise || loaded) return load(modelId)` makes the second caller join
  the first (same model) or wait for it (another model). The recursion ends because every pass awaits a pending
  load or returns. Correct, and needed: without it this PR's abandon would turn the hang into a spurious error for
  the first waiter.
- **Delete while loading.** The worker is terminated synchronously, before `deleteModelAllInfoInCache`, and the
  test pins that order. The waiter gets `error` and the deleter gets `deleted`.
- **Kept as is:** the SPC-18 job abandon, `attachLlmPort`, and the council tests (unchanged, green per the
  executor).
- **Can the tests fail?** I copied `test/ai/llmHost.test.ts` and `test/localGemma.test.tsx` into the PE worktree at
  11074ac. All 7 new T3.11 tests fail (×5 time out on the hang, plus the delete and two-loads tests) and 22 pass.
  The UI test passes on main, as expected, since no UI code changed: it pins the existing retry.

## LOW
### L1. Deleting a loading model reports "unloaded"
The load waiter (for example the options page) gets the default reason, "The local model was unloaded. Try
again.", after the user *deleted* the model. Clicking retry then downloads it again. Fix: `disposeEngine('The
local model was deleted.')` in the `delete` branch.

### L2. A load started during the delete re-fills the cache
`delete` awaits `deleteModelAllInfoInCache` with no guard. A `load` of the same model that arrives in that window
(another Port, or a fast retry) starts a new worker that writes shards while the cache is being wiped. This
problem existed before for the loaded-model delete, and nobody can trigger it at human speed in one UI. Fix (if
wanted): a `deleting` set that `load` awaits. Can also go in a follow-up ticket.
