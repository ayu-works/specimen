# SPC-37 review, lens B, round 1

PR #42 (`exec/spc-37` @ 3ff3afd). Reviewer: fresh lens B. Read: setup.md, the SPC-37 ticket and both comments, the
handoff, `gh pr diff 42`, `llmHost.ts` in full, `LocalGemma.tsx`, `aiRuntime.ts`, the `WebLLMClient` in
`packages/ai/src/providers/webllm.ts`, and councilHost's `attachLlmPort` use. Ran `llmHostRace.test.ts` + `llmHost.test.ts`:
43/43 green.

**Count: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 4 LOW.**

## What holds (checked, no finding)
- **Delete during a pending load** (windows 1–3): the token is cancelled synchronously, and `check()` runs after every
  await before anything with side effects. Window 3 is closed by installing `abandonLoad` before `await null`, and the
  body checks `abandoned` before `new Worker`. The opening `disposeEngine()` runs before the abandon is installed, so
  it can't reject its own load (PE's required change).
- **Unload during a load**: body → `disposeEngine` → `gone` rejects; queued or GPU-waiting loads → token. No path
  sends `ready` without an engine. `ready` is sent only after `load()` resolves, which needs `loadedId && engine` or a body
  that set both. A worker `error` is a macrotask and can't land between the resolve and the `send`.
- **Load during a delete**: it waits on `deleting.get(X)` and re-reads the map on every pass, so chained deletes are
  all waited for. A failed delete releases the waiters (`.catch`) and its `finally` removes only its own entry. A delete
  never waits on a load, so there is no deadlock.
- **Two loads plus a delete**: two loads of X at the GPU check are both cancelled. When joined on X's body, the shared
  rejection reaches each `handle` exactly once. A delete of Y doesn't touch a load of X (tested).
- **Stale load overwriting newer state**: a new body can only start after the old `loadPromise` is null, which happens in
  the old body's `finally`, after its `catch → disposeEngine()`. A late `CreateWebWorkerMLCEngine` result loses the race to `gone`,
  and late progress is gated on `worker === w`.
- **SPC-35 crash**: the `crashed` listener and `abandonLoad` path are unchanged, and a load of another model queued behind a
  crashed load still goes ahead (its token isn't cancelled; T3.11 still green).
- **SPC-18 abort/disconnect**: `chat`/`abort`/`dropPort` are untouched. A client abort or disconnect of a *load* still
  only ends the client side, and the host load continues by design ("keep the download going, you can close this page").
- **Council (`attachLlmPort`)**: unchanged. Council loads go through the same `load()` and get the same tokens.
- **Double resolve / leaks**: `abandonLoad` is idempotent (`abandoned ??=`), tokens leave `pending` in `finally`, and
  `deleting` drains (`expectIdle` asserts it). No new listeners.
- **Tests drive the real windows**: I traced them on the old code. GPU-gate unload/delete, window 3 (unload queued from
  `terminate()` lands before the body's first tick), unload while queued behind another model, and load-during-delete
  all fail on the old `llmHost.ts`. This matches the handoff's "6 fail on old code".

## MEDIUM

### M1. Options card: "Delete, then Download quickly" shows "Not downloaded" for the whole download, and the manual test can't run as written
`LocalGemma.tsx` (not in this PR, but the PR's manual test and its `status.loading` change are aimed at this card).
- **Scenario:** the card is `ready` (cached). The user clicks **Delete downloaded model**. `remove()` awaits `deleted` and the
  phase stays `ready`, so **Download & load** stays enabled. The user clicks it: `download()` sets `downloading`, and the
  new host makes the load wait for the delete (correct). Then `deleted` arrives, and `remove()` continues with
  `markDownloaded(false)`, `setPhase('none')` and `setProgress(0)`. The card now says **"Not downloaded"**, hides the progress bar
  and re-enables Download, while a multi-GB download runs underneath. When it finishes it flips to `ready`. The
  same applies to the handoff's manual test step "Download again quickly".
- The other manual step ("start a download, click Delete at once") **can't be done in the card**: Delete is
  `disabled={busy}` while `phase === 'downloading'`. So the owner's manual test doesn't exercise the main fix. In
  production a delete races a load only from a second Options tab opened earlier, or while the side panel or council
  loads.
- **Fix:** in the card, add a `deleting` phase (disable both buttons while `remove()` runs), or have `remove()` skip
  `setPhase('none')`/`setProgress(0)` when a `download()` started after it (a ref sequence counter). Either fold it in as
  a one-file change, or open a follow-up ticket and rewrite the PR's manual test so it can be done: "Options tab A
  (opened first, model ready): ask a question in the side panel to start a load, then click Delete in tab A → the panel's ask
  errors 'deleted', and tab A ends 'Not downloaded' with no download resuming".

## LOW

### L1. A cancelled load lingers until its current await settles: status says `loading`, and the caller's error is late
`llmHost.ts:167-177`. A cancel only sets `req.cancelled`, and the load notices only after the await it's in settles.
- **Scenario:** the side panel is loading model Y (a long download). Load X is queued behind it (window 1). A delete of X (another
  Options tab) cancels X's token, but X keeps waiting for Y's **whole download** before it errors "deleted". Until then
  `pending.size > 0`, so `status` reports `loading: true`. X's client shows "Downloading" (with Y's broadcast progress)
  for minutes. The same happens to a load waiting on a delete chain, and to one waiting on a slow `requestAdapter()`.
  A card reopened in that time sees `loading` and calls `download()`, a **fresh, uncancelled** load. Rare, because no UI
  sends `unload` today and Delete is disabled in a busy card, but it is the one path where the UI stays on "loading" for
  something that's already dead.
- **Fix:** give `LoadReq` a reject (`cancel: Promise<never>`) and race each await in `loadOnce` (`del`, `loadPromise`,
  `hasGpu()`) against it, so a cancel ends the load at once. Count only `!req.cancelled` tokens in `status.loading` and in `llmBusy`.
  One more test: delete X while X waits behind Y's gated load → X errors before Y's gate opens.

### L2. `status.loading` is model-agnostic and now covers more cases, so the card can auto-start a download nobody clicked
`llmHost.ts:328`, `LocalGemma.tsx:92`. The card's mount effect calls `download()` for **its** model whenever
`st.loading`. Before the PR that meant "a body is running". Now it also covers any pending load of any model.
- **Scenario:** the side panel's load of Y is pending (the GPU check, or waiting on a delete of Y), and the user picks
  radio X in the card (not busy, so the fieldset is enabled). The effect re-runs, sees `loading: true` and starts
  downloading X (GBs), which then disposes Y. This is pre-existing for a running body; the PR widens the window.
- **Fix (protocol change, so PE):** add the loading model's id to `status` (e.g. `loadingIds`) and have the card rejoin
  only when its model is in it. Or note it as a known limitation in the follow-up.

### L3. `llmBusy` isn't used in production, so the "keeps the offscreen document open" rationale doesn't apply
`llmBusy` is referenced only by tests (`grep -rn llmBusy apps/extension/src` → only its definition). Handoff note (b)
and the docstring say pending loads and deletes keep the document from closing, but nothing closes it based on this.
- **Fix:** none needed in code. Correct the handoff/docstring wording ("used by tests to assert the host drained"), or
  wire it where the document is closed if that was the intent (separate ticket).

### L4. Test gaps for the lens-B paths
The suite covers the core windows well. Missing:
- **Delete in window 1:** delete X while X waits behind Y's gated load → X errors "deleted", Y still ends `ready`, and
  only one Worker is created. (Today only unload is tested in window 1.)
- **Unload while a load waits on a delete:** the load errors "unloaded" (and, with L1's fix, before the delete gate opens).
- **Crash with a queued token:** Y's worker crashes while X waits behind it → X goes ahead to `ready` (SPC-35 + tokens
  together; T3.11 covers it only without SPC-37's paths in play).
- **Port closes while its load waits on a delete:** no throw, the load still completes, `pending`/`deleting` drain, and
  `llmBusy()` goes false after `unload`. This pins down the intended "load outlives its port" semantics.
- `a delete of another model does not cancel a pending load` ends without `expectIdle`. Add it for symmetry.
