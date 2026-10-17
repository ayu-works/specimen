# SPC-35 review: lens B + security, round 1

PR #34 (`exec/spc-35` @ ccae91c). Reviewer: fresh second reviewer (lens B + security). Read-only apart from this file.

**Verdict: no CRITICAL or HIGH findings. 1 MEDIUM, 4 LOW (one of them pre-existing). Security: nothing found.**

## What I checked and found sound

- **Crash or dispose at each point of a load.**
  - *Before `hasGpu()` resolves:* this load has no worker yet and `abandonLoad` is null. A crash of the previous worker goes down the #31 path, and the load then goes ahead. Correct.
  - *Mid-download:* `crashed` → `disposeEngine(reason)` → `abandonLoad` rejects `gone` → the race rejects → `catch` (second `disposeEngine()`: calling `abandonLoad` again does nothing, `worker` is already null) → `finally` clears all state. The message matches no `classify` regex, so the error arrives as `kind:'other'` with the text intact.
  - *After ready:* `abandonLoad` is already null, so the #31 path is unchanged. Nothing can call `disposeEngine` between the race settling and `finally`. Only tasks (Port messages, worker events) call it, and the gap is microtasks only.
- **The load's own initial `disposeEngine()`** runs before `abandonLoad` is set, so the load can't reject itself.
- **Two or more waiters:** they all await the same `loadPromise`, and each gets exactly one `error`. A waiter that joins through the new recursion gets `loadPromise` back from line 132.
- **The race fix (line 136):** from the re-check through `loadPromise = (async …)()`, everything runs synchronously, because the IIFE body is synchronous up to its first `await`. So there's no window left between the check and the assignment. The one exception is a synchronous throw (M1). A load of a different model sent together recurses, waits for the first load, then loads. That's correct, but untested (L3).
- **Retry:** `finally` clears `abandonLoad`, so a retry's initial dispose doesn't touch the dead load. Late progress from the dead worker is dropped by `worker !== w`. A late result is never assigned, because the race has already settled.
- **Disconnect during a load:** the load keeps running (by design, T3.11 "a load is not cancelled"). The dead Port's `send` is swallowed, and the other waiters still get their result.
- **Leaks:** each load's `error`/`messageerror` listeners stay on a worker that is terminated, so they die with it. There are no timers. The pending `CreateWebWorkerMLCEngine` promise of a terminated worker is unreachable once the IIFE finishes.
- **The `delete` change:** while a load is running, `loadedId` is undefined (the load's initial dispose cleared it). So `disposeEngine()` only stops the load and can't unload some other loaded model. The test pins the order: terminate first, then delete.

## MEDIUM

### M1. A synchronous throw in the load IIFE leaves `loadPromise` stuck. The new re-check turns that into an endless loop.
`llmHost.ts:140-176`. The IIFE runs synchronously until its first `await`. If anything before that `await` throws synchronously (`new Worker(...)`, or `buildAppConfig()` → `chrome.runtime.getURL`, which is evaluated as an argument before `CreateWebWorkerMLCEngine` is called), the `catch` and `finally` blocks run *before* the IIFE returns. `finally` sets `loadPromise = null`. Then line 140 assigns `loadPromise =` the already-rejected promise, and nothing ever clears it.

**Failure scenario:** `new Worker(...)` throws synchronously (for example, a SecurityError, or the browser refusing to create the worker). The first waiter gets the error, which is fine. After that, `status` reports `loading: true` for ever, and `llmBusy()` stays true for ever, so the offscreen document never closes. When the options card opens and sees `st.loading`, it calls `download()` automatically (`LocalGemma.tsx:92-94`). That `load(X)` then:
1. finds `loadingId` undefined at line 132;
2. awaits the stale promise at line 133;
3. calls `hasGpu()`;
4. sees `loadPromise` still truthy at line 136 and recurses.

This repeats for ever: an endless async loop that calls `requestAdapter()` on every turn, while the waiter hangs. Before this PR, the stale promise was simply awaited and then overwritten. The line 136 re-check is what turns stale state into a loop. It's unlikely, but it's the same "pending for ever" class of bug this ticket exists to remove.

**Fix:** make sure `loadPromise` is assigned before any of the body runs. Either start the IIFE with `await null;` (nothing can run in between, because only tasks dispose), or build the promise first and then run the body. As a belt-and-braces measure, clear state in `finally` only when `loadPromise === thisLoad`. Add a T3.11 test where the fake `Worker` constructor throws once: the load gets an `error`, `status` reports `loading:false`, and the next load reaches `ready`.

## LOW

### L1. A `delete` (or `unload`) sent while a load is still waiting to start is lost.
`llmHost.ts:132-136, 314`. A load that is still in the `hasGpu()` await, or queued behind another model's load at line 133, hasn't set `loadingId` yet. `delete` checks `loadingId === msg.modelId`, so it doesn't stop that load.

**Failure scenario:** a side-panel chat triggers `load(X)` while `load(Y)` is still running. In another options tab the user deletes X: `deleted` is reported and the cache is cleared. Then Y finishes and `load(X)` starts, downloads X again, and its waiter gets `ready`. The model the user just deleted is back. `unload` behaves the same way: an unload that lands during the `hasGpu()` window is silently overridden.

**Fix (optional; the window is small):** keep a load generation counter. `unload` and `delete` bump it (or keep a "cancelled ids" set). After its awaits, `load` rejects with "unloaded/deleted" if the generation changed. Otherwise, write down in the handoff that delete and unload only affect a load that has already started.

### L2. A load stopped by `delete` tells its waiter "The local model was unloaded. Try again."
`llmHost.ts:314`. `disposeEngine()` is called without a reason, so the loader (possibly another tab) sees "unloaded" when the model was in fact deleted. "Try again" then downloads it all over again. **Fix:** `disposeEngine('The model was deleted.')` (no "Try again"), and update the test's regex to match.

### L3. Test gaps for two of the new claims.
- **"The dead load's late result is ignored":** the fake `CreateWebWorkerMLCEngine` returns the same `engine` singleton every time, so the retry test couldn't tell whether a late assignment from the dead load happened. Return a distinct fake engine per call (tagged with the load index), then assert that the chat after the retry runs on the retry's engine.
- **The race fix's other branch:** there's no test for loads of *two different models* sent together. Expected behaviour: one worker at a time, the first waiter gets `ready(X)`, the second gets `ready(Y)`, and `status.loaded === Y` at the end. Before the fix, two workers started here too.
- **M1:** see M1's fix for the missing synchronous-throw test.

### L4. (Pre-existing, not introduced by this PR) `void engine?.unload()` can cause an unhandled rejection.
`llmHost.ts:118-122`. The `try/catch` only catches synchronous throws. If `unload()` returns a rejected promise, that becomes an `unhandledrejection` in the offscreen document. `interrupt()` already uses the right pattern: `void Promise.resolve(engine?.unload()).catch(() => {})`. This is a one-line fix if you're touching the function anyway. Otherwise ignore it.

## Security

- **No new message types or handlers.** The only new code reachable from messages is `abandonLoad`, which existing message types reach through `disposeEngine()`. The ones that can trigger it are `unload` and a `delete` of the loading model, and both were already engine-wide.
- **Who can reach the Port:** unchanged. `startLlmHost` only accepts `port.name === LLM_PORT` with `sender.url` under the extension origin. There's no `onConnectExternal` listener, so content scripts and web pages can't connect. The council's in-page Port is the extension's own code.
- **Cross-context effects:** any extension page can already stop another page's load with `unload` or `delete`. That's the same trust domain, and the behaviour is the same as before for a loaded model. Chats keep the per-Port, per-id isolation from SPC-18. This PR can't make one Port abort or read another Port's chat.
- **Where data goes:** error text goes only to the requesting Port, as before. The new messages are fixed strings. Nothing is added to `console`, no page data is involved, and nothing leaves the browser.
