# SPC-37: local Gemma load / unload / delete races

Executor: spc-37-11 · PE: pe-b2 · Orchestrator: specimen-75 · Branch `exec/spc-37` from `origin/main` b01ea77.

## Plan (APPROVED by pe-b2, 2026-10-17, with 1 required change, folded in below)

### The bugs (in `apps/extension/src/entrypoints/offscreen/llmHost.ts`)
`load()` has three awaits before a load becomes visible to `unload`/`delete`:
1. `await loadPromise.catch()` (waiting behind another model's load),
2. `await hasGpu()`; `loadingId` is only set after this,
3. `await null` at the top of the load body; `abandonLoad` is only set after this.

An `unload`, or a `delete` of that model, that lands in any of these windows finds nothing to cancel
(`loadingId` unset, `abandonLoad` null), says it's done, and the load then goes ahead: a model ends up
resident after "unloaded", or the shards are downloaded again right after "deleted".

Second race: `delete` awaits `deleteModelAllInfoInCache()`. A `load` of the same model that arrives during
that await starts downloading at once, so the delete and the download overlap on the same cache
entries (a partly cleared or refilled cache).

### Approach
Two small pieces of module state:

- **`pending: Set<LoadReq>`**, where `LoadReq = { modelId, cancelled?: Error }`. Each `load(modelId)` call
  makes one token at entry and removes it in a `finally`. `unload` cancels every token; `delete(X)` cancels the
  tokens whose `modelId === X`. A cancel only records the reason: `cancelled = new Error(msg)`, with the same
  messages as today ("…unloaded. Try again." / "…deleted. Download it again to use it.").
  `load()` calls `check(req)` (it throws `req.cancelled`) after each await: after waiting for a delete, after
  waiting behind another load, after `hasGpu()`. The recursive "someone started a load meanwhile" path keeps
  the same token: an inner `loadOnce(req)` replaces the recursion `load(modelId)`.
  The load body also checks for a cancel right after its `await null`, against a body-level flag that
  unload/delete set (`bodyCancelled`, cleared when the body starts). Joined callers share `loadPromise`,
  so a cancel there rejects them all, as `abandonLoad` already does once the worker exists.
  Simpler alternative I'll use if it reads better: set `abandonLoad` synchronously **before** `await null`
  (the `gone` promise can be created before the body runs). Then `disposeEngine()` already rejects the
  pending body during its first tick, and window 3 closes without a new flag. The body then checks
  "rejected already?" before it creates the Worker. I'll pick this one unless it gets messy.
- **`deleting: Map<modelId, Promise<void>>`**. `delete(X)` cancels/disposes first (as today), then
  registers its cache-clear promise in `deleting`, and removes it in `finally` only if the entry is still
  its own (two deletes of the same model chain: the second awaits the first). `load(X)` waits with
  `while (deleting.has(X)) await deleting.get(X).catch(() => {})` **after** making its token, so a load
  that came after a delete is not cancelled by that delete (the token didn't exist at cancel time), it just
  waits, then loads cleanly. A delete's failure doesn't fail the waiting load.

Semantics, stated: an `unload` cancels every load requested before it. A `delete(X)` cancels loads of X
requested before it, and loads of X requested during it wait for it. A delete of another model doesn't
touch a load of X. A cancelled load's caller gets the same `error` event (`kind: 'other'`, "unloaded"/"deleted")
it already gets when the cancel lands after the worker exists. Never a `ready`.

- `llmBusy()` also returns true while `pending.size > 0 || deleting.size > 0`, so the offscreen document
  isn't closed between a delete and the load waiting on it (and the tests can check that the state drains to
  empty).
- Unchanged: `attachLlmPort`, the `chat`/`abort` queue, SPC-18's per-Port stop, SPC-35's crash/abandon
  handling, the Port protocol (no new events or fields), councilHost.

### Files
- `apps/extension/src/entrypoints/offscreen/llmHost.ts` (Owned).
- **New** `apps/extension/test/ai/llmHostRace.test.ts`. `llmHost.test.ts` is **not** edited: open PR #40
  owns it (file rule from pe-b2 via specimen-75). The new file carries a small copy of the fake web-llm +
  Worker + chrome stubs, plus gates on `hasGpu` (navigator.gpu.requestAdapter), on `CreateWebWorkerMLCEngine`
  and on `deleteModelAllInfoInCache`, so each window can be held open on purpose. No real model, worker or network.
- `docs/TESTING.md`: a **new row T3.37** (U, SPC-37). The T3.11 row is not edited (PR #40 edits it).
  If another open PR also claims T3.37, I'll take the next free id when I rebase.

### Tests (T3.37, all in llmHostRace.test.ts)
1. **Unload in window 2** (load held at `hasGpu`): the load ends in an `error` "unloaded", no `ready`, no
   Worker created (`log` has no `worker`), and `status` says `loaded: undefined, loading: false`.
2. **Delete in window 2**: same, "deleted", and the cache delete happened with no Worker before or after it.
3. **Unload in window 3** (`loadPromise` set, body not yet run, so `unload` arrives in the same tick as the
   `load` message): no Worker, no `ready`, an error. All the joined waiters get exactly one error.
4. **Unload while waiting behind another model's load** (window 1): A loads (gated), B queues behind it, unload:
   both end in an error, neither gets `ready`, no model resident, no third worker.
5. **Load during a delete**: delete gated inside `deleteModelAllInfoInCache`, then load. Assert no Worker is
   created while the gate is shut. Open the gate: log is `['delete', 'worker']` in that order, the load ends
   `ready`, and `status.loaded` is the model.
6. **Load during a delete that fails**: the delete's port gets the error, the waiting load still gets `ready`.
7. **Two deletes + a load**: the load waits for both (log `delete, delete, worker`).
8. **Delete of another model doesn't cancel a load** held at `hasGpu`: it ends `ready`.
9. **No leaks / no double resolve**: after each scenario, disconnect the ports, wait for things to settle, then
   `llmBusy() === false` (the pending set and the deleting map are empty). Each port got exactly one terminal event per
   load (one `ready` or one `error`). A late cancel after `ready` (unload) doesn't produce a second load event.
10. **A load after a cancelled load works** (a fresh token isn't affected by an old cancel).

`pnpm gate` stays green with the existing T3.11 and council tests unchanged (they run as-is; I don't edit them).

### Failure modes
- **Atomicity:** each cancel is synchronous (it only sets fields and calls `disposeEngine`), so no await sits
  between "decide to cancel" and "cancel". The load checks after every await, and nothing with side effects
  (Worker, `disposeEngine()` of a live engine) runs before the last check.
- **Idempotency:** cancelling an already cancelled or settled token is a no-op (the first reason wins). Two
  unloads are fine. Two deletes chain.
- **Partial failure:** a failing `deleteModelAllInfoInCache` still removes its `deleting` entry (`finally`) and
  releases waiters. A failing `hasGpu` / Worker throw removes the token (`finally`).
- **Errors during cleanup:** `disposeEngine` is already throw-safe. The token cleanup is in `finally`.
- **Concurrency:** covered above. The load body's existing `disposeEngine()` at start is unchanged. A crashed
  worker still goes through `abandonLoad`. A cancelled waiter on a joined `loadPromise` gets the shared
  rejection exactly once (one `send` per `handle` call).
- **Drift between two copies of a fact:** `loadingId`/`loadPromise` (the running body) vs `pending` (every
  requested load). `status.loading` keeps meaning "a body is running" (unchanged protocol). `pending` is
  used only for cancelling and for `llmBusy`. Delete's existing `loadingId === X` check stays for the running
  body, and the token cancel handles the rest.
- **Liveness:** a load waiting for a delete can't deadlock. A delete never waits on a load (it disposes first).

### Owner manual test (for the PR body)
Options → Local Gemma: start a download, click Delete at once: the card ends "not downloaded", and reopening
shows no model loaded and no download resuming. Click Download and right after it Delete, then Download again
quickly: the second download finishes and the model works in Ask.

## PE approval notes and how they were folded in
- **REQUIRED 1** (abandon installed before `await null` would make the body's own first `disposeEngine()` reject
  its own load): I took the alternative. `load` now runs that dispose synchronously, **then** installs
  `abandonLoad`, then `await null`. The body checks `abandoned` before it makes the Worker. Windows 1 and 2 use
  the token approach (`pending`). Tests: "a plain load still ends ready" plus "an unload after the load body is
  set up but before it runs" (it queues the unload from the old engine's `terminate()` during the switch, so it
  lands exactly in window 3).
- **(a) Options card:** `LocalGemma.tsx` keeps its own `downloading` phase while its own `load()` is pending,
  but on mount it trusts `status.loading`. A card reopened while a load waits on a delete or the GPU check would
  have shown "Not downloaded". Change (one line, no protocol change): `status.loading` is also true while any
  load is pending, with `p: 0` until the body reports progress. A reopened card rejoins (its `load` waits for the
  same delete). Tested in "a load during a delete waits for it".
- **(b)** `llmBusy` counts pending loads and deletes. A `hasGpu()` that never settles keeps the offscreen document
  open. Accepted.
- **(c)** `llmHostRace.test.ts` carries a trimmed copy of the stubs, with a header comment naming
  `llmHost.test.ts` as the source. A shared helper is a follow-up after PR #40 merges.

## Done
- Read brief, setup, plan, ticket (no comments). `pnpm i`. Plan written and APPROVED (pe-b2).
- `llmHost.ts`: `pending` tokens + `cancelLoads`, `deleting` map (deletes of one model chain, loads wait),
  abandon installed before the body's first tick, `status.loading` and `llmBusy` count pending work.
- `test/ai/llmHostRace.test.ts` (10 tests, T3.37). 6 of them fail on the old `llmHost.ts` (checked by swapping
  the file back); the other 4 are guards. `llmHost.test.ts` (T3.11) and the council tests are unchanged and green.
- `docs/TESTING.md`: new row T3.37 (T3.11 untouched).
- `pnpm gate` green.

## Next
- Lens A r1: APPROVED, 0 findings (docs/sprint/reviews/SPC-37-a-r1.md). Waiting on lens B.
- Follow-up: extract the shared fake web-llm/Worker harness after #40 merges.

## How to resume
Worktree `worktrees/spc-37`, branch `exec/spc-37`. Read this file, then `git log origin/main..`.
