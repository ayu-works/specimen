# SPC-18 lens A r1 (PE pe-ed, 2026-10-17): PR #31 at 3ae1b68

**Verdict: APPROVED. 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW** (both optional).

## What I checked
- **The tests can fail.** I ran the new `test/ai/llmHost.test.ts` against `origin/main`'s `llmHost.ts`: 12 of 16
  fail, including every H1/H2 case. On 3ae1b68 they pass. `llmHost.test.ts`, `councilHost.test.ts` and
  `council.test.tsx` pass together: 52/52. CI on #31 is green and the PR is CLEAN.
- **The fake matches production.**
  - `interruptGenerate` ends whichever stream is current with `finish_reason: 'abort'`.
  - An interrupt sent before the first `next()` is lost, because the generator body hasn't run yet. That is the
    same window as the real worker's per-generate reset (web-llm 0.2.85 `lib/index.js:12940`).
  - The fake Port's `disconnect()` fires only the host's `onDisconnect`, and posts throw afterwards, like Chrome.
- **One source of truth for "stopped".** The id-keyed global `aborted` set is gone, and everything reads
  `job.stopped`. `stop()` interrupts only when `running === job`, so a queued job's abort can't touch the engine.
  `finally` removes the job only if the map still holds this same object.
- **No "success that did nothing".**
  - A stopped job always ends `error aborted`, including when the stream throws after the stop.
  - A stream that ends `abort` without this job's stop ends in `error`, never `done`.
  - A stale interrupt on an idle engine is cleared by the worker when the next generation starts, so it can't cut
    the next chat.
- **Errors during cleanup.** `interrupt()` swallows both a sync throw and an async rejection. A failed post becomes
  `dropPort`, which stops that Port's own jobs. The chain moves on in every case, including when the interrupt
  keeps failing: the drain then runs to the natural end (test 10).
- **Protocol.** There is no protocol change: `aborted` is an existing `ProviderErrorKind`, and `attachLlmPort`
  keeps its signature. The PR body names the council tests it ran (T3.31 SW-halt included).
- **CLAUDE.md rules.** No permissions, keys or page data are touched.

## LOW

### L1. The duplicate-id refusal is sent under the duplicated id, so the first chat's client also fails
`handle('chat')` answers a duplicate with `error {id: msg.id}`. The client (`webllm.ts:157`) routes any `error`
for its id to the in-flight call, so on the client side the *first* chat fails too, while the host keeps
generating it to a Port nobody is listening on. Client ids are fresh per call, so this can't happen today.
**Fix (optional):** leave as is and add a one-line comment saying ids are unique per Port by the client's
contract. Or stop the existing job too, so the host and the client agree.

### L2. While a job is stopped, `interrupt()` runs on every remaining chunk
This sends one worker message per chunk until the stream ends. In practice the stream ends within one or two
chunks, so the cost is negligible. **Fix (optional):** interrupt at most once per N chunks, or only when no
interrupt is pending. Not needed for merge.

## Fold check (e1158e6, on top of 3ae1b68): APPROVED
- **Lens B H1 re-checked.** `disposeEngine` rejects the running job's `gone` before it terminates the worker.
  `create()` and every `next()` race `gone`, so an unload, a delete, another model's load or a worker
  `error`/`messageerror` ends the chat with a fixed-text `error` (not `done`), and `finally` frees `running` and
  the chain. Rejections of the abandoned `create`/`next` promises are handled by the race, and `gone` has its own
  catch, so nothing is left unhandled. The `worker === w` guard stops a stale worker's late error from disposing
  a newer engine. On this head, `llmHost` + `councilHost` + `council` pass 57/57 (I ran them).
- **Lens B L2 (sender check).** `port.sender.url.startsWith(chrome.runtime.getURL(''))`. The only connector is
  `webllm.ts`, which runs in extension pages (side panel, options), and the council attaches in-page, not via
  `onConnect`. A content script's sender URL is the web page's, so it is refused. Correct.
- **My L1:** comment added. **My L2:** left as is; accepted.
- Known gap, filed by the orchestrator: a worker crash *during a load* still leaves `CreateWebWorkerMLCEngine`
  pending, so `loadPromise` never settles. This is not a regression; it is the same as on main.
