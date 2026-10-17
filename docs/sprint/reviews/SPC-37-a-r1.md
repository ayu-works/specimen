# SPC-37 lens A r1 (PE pe-b2, 2026-10-17)

PR #42 @ 3ff3afd: `llmHost.ts`, the new `test/ai/llmHostRace.test.ts` (T3.37), and TESTING.md. I ran
llmHostRace + llmHost + council + localGemma here: 64/64 green.
**Proof run:** I ran the new test file against origin/main's `llmHost.ts`. **6/10 fail**, the cancel and wait cases:
GPU-check unload, GPU-check delete, the unload before the body runs, waiting behind another model, the load during a delete, and two deletes.
The 4 that pass are controls (a plain load, another model's delete, a failed delete, an unload after ready).

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW.**

## Checks
- **Required change (self-abandon):** done right. `disposeEngine()` now runs synchronously *before* this load's
  `abandonLoad` is installed, and `abandonLoad` is set before `await null`. So an unload or delete in the gap rejects the
  load (`abandoned` is checked before `new Worker`), and a plain load reaches ready (test 1).
- **The old body's `finally` can't clear the new `abandonLoad`:** a new body is set up only when `loadPromise` is null,
  and the old body nulls `loadPromise` and `abandonLoad` in the same synchronous `finally`.
- **Every await is followed by `check()`:** the delete wait, the wait behind another load, and `hasGpu`. The join path
  (`return loadPromise`) needs no token, because unload and delete reach it through `disposeEngine` (`loadingId` is
  set synchronously before the body).
- **Semantics:** a load that arrives *during* a delete has a token created after the cancel, so it isn't
  cancelled, and the loop re-reads `deleting` until no delete is left (it chains to the last one). A failed delete
  doesn't fail the waiter. `cancelled ??=` keeps the first reason.
- **No leaks:** the token is removed in `load`'s `finally`. A `deleting` entry is removed only if it's still its own.
  `llmBusy` counts both.
- **`status.loading` now includes pending tokens (extra, for my note (a)):** this is a value change, not a new field,
  so the Port protocol shape is unchanged. A reopened card shows downloading at `p: 0` and rejoins with its own `load`,
  which waits correctly. Accepted.
- Unchanged: `attachLlmPort`, the chat queue, SPC-18 per-Port stop, SPC-35 abandon/crash. llmHost.test.ts (T3.11)
  and council tests pass unedited.

No follow-up beyond the shared-stub helper already noted (after #40 merges).
