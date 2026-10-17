# SPC-18 lens B + security review, round 1

Reviewer: fresh second reviewer (lens B + security). PR #31 at `3ae1b68`. Read: setup.md, SPC-18 and all its comments,
failure-path-audit H1/H2/M6, the handoff, CLAUDE.md Rules, `gh pr diff 31`, `llmHost.ts`, `webllm.ts` (client),
`localPort.ts`, `councilHost.ts` (the webllm connect), `options/LocalGemma.tsx`, and the WebWorkerMLCEngine client and
worker in `@mlc-ai/web-llm@0.2.85/lib/index.js`.

**Count: 0 CRITICAL · 1 HIGH · 0 MEDIUM · 3 LOW.**

## Checked and fine
- **Abort while queued:** `stop()` only sets `stopped`. `runChat` sends `error aborted` without calling `create`, and the
  running job is untouched (no interrupt, since `running !== job`).
- **Abort mid-stream:** the interrupt goes out, the stream is drained, and the job ends `error aborted`, never `done`.
  **Abort during `await create()`:** `running` is set before `create`, so the interrupt is sent. If the worker loses it
  (the reset at `lib/index.js:13214` runs after the lock), the re-interrupt on the first chunk covers it.
- **Abort after done / double abort:** the job is gone from `jobs`, or `stopped` is already set, so it's a no-op.
- **Two ports, and two chats on one port:** state is keyed by (Port, id). The client opens a fresh Port per chat
  (`webllm.ts:136`) and disconnects it in `finally`, so `dropPort` after `done` finds nothing to stop.
- **Stray interrupt into the next chat:** the worker handles messages in FIFO order, and the next chat's `_generate`
  clears `interruptSignal` before it decodes, so a late re-interrupt from a stopped job can't cut the next one. If one
  did, the `finish === 'abort'` guard turns it into `error`, not `done`.
- **Disconnect during load:** the load is shared and goes on. `send` to the dead Port is caught. A chat queued behind
  it is skipped.
- **Reopened panel:** a new Port, and the old Port's job is stopped through `onDisconnect`.
- **Council together with Ask:** both share `chatChain`. `localPort` drops messages after `disconnect()` (`open` is
  checked when each message is delivered), so a `chat` message can't arrive after `dropPort` and run on a dead Port.
- **Errors in cleanup:** `interrupt()` swallows both a throw and a rejection, `send` swallows a throw, and `finally` is
  synchronous and can't throw. `runChat` never rejects, so the chain can't break.
- **Leaks:** each job is removed in `finally`, and an empty map is removed with it. `ports` loses a Port on disconnect
  or on a failed post. No timers or listeners are added per chat.
- **Security:** an abort for another Port's id, or an unknown id, does nothing (the cross-port abort is closed). Errors,
  deltas and `done` go only to the Port that owns the job. Only `progress` is broadcast, and it carries just a
  percentage and WebLLM's status text. Nothing is logged, and prompt text goes only to the local worker. No
  permissions, keys or network calls change.

## HIGH

### H1. When the engine is disposed or crashes mid-chat, that chat hangs, and so does every later chat (including the council)
`disposeEngine()` calls `void engine.unload()` and then `worker.terminate()` at once. The WebWorkerMLCEngine client
settles a pending call only from `worker.onmessage` (`lib/index.js:14362-14390, 14625-14650`). There is no
`onerror`, no timeout, and no reject on terminate. So the running chat's `await stream.next()`, or its
`await create()`, never settles. `runChat` never reaches `finally`, `chatChain` never moves, and every later chat on
any Port waits for ever.

The plan claims the opposite (handoff step 8: "If a chat is running when its engine is disposed (unload/delete), the
stream throws and the job ends in error, never done"). No test covers it: the fake `unload` and `terminate()` are
no-ops, and the fake stream keeps going.

Ways to get there today:
- Options → Local Gemma → **Delete** the loaded model while Ask or the council is answering (`delete` →
  `disposeEngine`).
- Options → **Download/Load another model** while a chat streams (`load(other)` → `disposeEngine()` at line 129).
- An `unload` request from any Port.
- The worker dies (GPU device lost, OOM kill). There is no `worker.onerror`, so the same hang follows.

Stop and closing the panel don't recover it. `stop()` → `interrupt()` targets `engine`, which is now `null` or the new
engine. The job stays `running` and the chain stays blocked until the extension reloads. Every later Ask or council
member shows a spinner that never ends, which is H2's symptom but permanent. The bug is older than this PR, but it is
in M6's scope, the PR states the behaviour, and this PR's own "drain, don't break" depends on the stream ending.

**Fix:**
1. Give each run an "abandon" handle: a deferred that `disposeEngine()` rejects for the `running` job. Do the same
   from `worker.addEventListener('error' | 'messageerror')`.
2. In `runChat`, race `create()` and each `iterator.next()` against that handle instead of using a bare `for await`.
   When it fires, end the job with `error` (`aborted` if `job.stopped`, else `kind:'other'`, e.g. "The local model
   was unloaded. Try again."), then run `finally`.
3. Optionally, have `delete` and `load(other)` stop the running job and wait for its drain first (bounded, e.g. 2 s)
   before disposing. Then the user's own chat ends cleanly as `aborted` rather than via the race.

**Test (T3.11):** make the fake `terminate()` leave the current (manual) stream pending for ever. Start a chat, send
`unload` (and, as a second case, `delete` of the loaded model) mid-stream. Expect `error` for that id and no `done`.
After a new `load`, a chat on a new Port completes. Add one more case where the worker fires `error` mid-stream.

## LOW

### L1. A stop during prefill only takes effect after the first token, so "the next chat starts within a second or two" can fail
If a job is stopped before or during prefill, the worker resets the flag at `_generate` (`lib/index.js:13171`), and
prefill can't be interrupted anyway. The next chat therefore waits for the stopped chat's full prefill plus one decode
step. Council and Ask prompts hold a large `<page_data>` block, so on a weak GPU that wait can run to tens of seconds.
The design is still correct; only the expectation is off. **Fix:** no code change. Reword the owner's manual check in
the handoff and PR to say "after the old prompt's prefill, not after its full answer", so a slow case isn't read as a
failure.

### L2. The `llm` Port doesn't check its sender (defence in depth, older than this PR)
`startLlmHost` accepts any `onConnect` named `llm`. That includes the extension's own content scripts (sampler and
overlay), which run inside arbitrary pages. Web pages can't reach `onConnect`, so nothing is exploitable today. But a
Port from a page context could still send `unload`/`delete` and stop every other client's chat (see H1), or use the
GPU. **Fix:** in `startLlmHost`, `if (port.sender?.tab) return;`. Only the side panel, options and offscreen pages
should talk to the host. The in-page council Port goes through `attachLlmPort` directly and isn't affected.

### L3. `finish_reason: 'length'` still reports `done`
When a chat hits `max_tokens`, the host sends `done` for text that was cut short. For Ask that's acceptable. For a
council member with `json: true` it gives truncated JSON that looks like a finished answer. This belongs to the same
"misleading success" class this PR fixes for `abort`, but the bug is older than the PR and out of its scope. **Fix
(follow-up ticket, not this PR):** pass `finish` through on `done` (a protocol addition with a version note), or let
the council treat its parse failure as "cut short". Noting it so it isn't lost.
