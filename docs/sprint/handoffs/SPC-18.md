# SPC-18 handoff: local Gemma abort/disconnect (audit H1, H2, plus M6)

Executor session: `spc-18-80` · Branch `exec/spc-18` (from origin/main 77ac925) · Lane B (resume 2026-10-17) · PE `pe-ed` · Orchestrator `specimen-6a`

## Plan (APPROVED by pe-ed 2026-10-17; notes folded: vi.resetModules, Chrome-like fake Port, council tests named in the PR)

### The bugs (today's `apps/extension/src/entrypoints/offscreen/llmHost.ts`)
- **H1:** `abort` adds the id to a global `aborted` set and calls the engine-wide `interruptGenerate()`. Aborting chat B
  while it is still queued behind A cuts A short; A's loop sees no abort for its own id and sends `done`, so partial
  text looks like a full answer.
- **H2:** `onDisconnect` only drops the port from `ports`. The closed panel's chat runs to the end and holds
  `chatChain`, so the next chat (any port, including the council's in-page port) waits for it.
- **Found while reading WebLLM 0.2.85** (`lib/index.js`): (a) the worker resets `interruptSignal = false` at the start
  of every `asyncGenerate`, so an interrupt sent between `create()` and the first chunk is lost; (b) the worker stream is
  pull-based (`completionStreamNextChunk`) and the model lock is released only when the worker's generator finishes, so
  today's `break` out of `for await` can leave the worker's generator suspended mid-stream. The fix below drains the
  stream instead of breaking.
- **Security side note:** `aborted` is keyed by id alone, so any port can stop another port's chat by sending its id.
  The fix keys every job by (port, id).

### Approach (one file: `llmHost.ts`; `attachLlmPort`'s signature and behaviour stay the same)
1. **A job per chat:** `{ port, id, req, state: 'queued' | 'running' | 'ended', stopped: boolean }`, kept in
   `jobs: Map<Port, Map<id, Job>>`. `running: Job | null` is the one the engine is generating.
2. **chat:** a duplicate id still active on the same port gets `error {id, kind:'other'}` and is not queued (keeps the
   map honest). Otherwise the job is added and chained on `chatChain` as today (one generation at a time).
3. **runChat(job):** if `job.stopped` when its turn comes, it never calls the engine: it sends
   `error {id, kind:'aborted', message:'Stopped'}` (guarded `send`) and the chain moves on. Otherwise
   `running = job`, `create()`, then **drain**: for each chunk, if `job.stopped` call `interrupt()` again (covers the lost
   interrupt in (a)) and drop the text; else send `delta`. When the stream ends:
   - `job.stopped` → `error {kind:'aborted'}` (not `done`; the client already threw `aborted`, so nothing visible
     changes for it).
   - the last chunk's `finish_reason === 'abort'` while the job was **not** stopped (something else interrupted it) →
     `error {kind:'other', message:'The answer was cut short. Try again.'}`, never `done`. Belt-and-braces for H1.
   - else `done`.
   `finally`: `running = null` (only if it is still this job), remove the job from `jobs`, drop the port's empty map.
4. **abort {id}:** look the job up **on this port only**. Unknown id or another port's id → no-op (no interrupt).
   Queued → `stopped = true` (it is skipped when its turn comes; nothing else is touched). Running → `stopped = true`
   and `interrupt()` **only if `running === job`**.
5. **onDisconnect:** `ports.delete(port)`, then every job of that port gets `stopped = true`; if the running job is one
   of them, `interrupt()`. Other ports' jobs are untouched. The chain moves on as soon as the stream drains (one decode
   step), so the next chat starts without waiting for the full answer.
6. **interrupt():** `try { void Promise.resolve(engine?.interruptGenerate()).catch(() => {}) } catch {}`; an error
   while stopping never escapes or breaks the chain.
7. **Load is shared, so it is not cancelled by a disconnect or abort:** another port (or the council) may be waiting on
   the same `loadPromise`. A port that goes away during a load just stops getting `progress`/`ready` (sends are
   guarded); the load finishes and the model stays loaded for the next try. A chat queued behind or during a load and
   then aborted is skipped as in step 3.
8. **M6:** delete of the loaded model disposes the engine (as today); a rejecting `deleteModelAllInfoInCache` gives an
   `error` event (as today, now tested). If a chat is running when its engine is disposed (unload/delete), the stream
   throws and the job ends in `error`, never `done`.
   **Corrected in review (lens B H1):** the WebWorkerMLCEngine client never settles a call after `terminate()`, so the
   stream does *not* throw; see "Review r1" below.

The client (`packages/ai/src/providers/webllm.ts`) is not changed: it already ignores events for other ids, throws
`aborted` locally on abort and treats any `error` for its id as a failure.

### Failure modes
| Case | Behaviour |
|---|---|
| Abort queued B while A runs | A gets every delta then `done`; no interrupt is sent; B never reaches the engine, gets `error aborted` |
| Abort running A while B queued | Interrupt sent; A ends `error aborted` (no `done`); B starts and completes |
| Abort with another port's id / unknown id | No-op, no interrupt |
| Abort sent before the worker started generating (lost interrupt) | Re-interrupt on every chunk while stopped |
| Port disconnects mid-stream | Its job stopped + interrupted; B on a new port starts after one drain step, not after A's full answer |
| Port disconnects while its chat is queued | Job skipped, engine never called for it |
| Port disconnects during load | Load continues; other ports still get `ready`; no throw from posting to the dead port |
| `interruptGenerate` throws / rejects | Swallowed; chain continues; the stopped job still ends |
| `postMessage` throws (dead port) during delta/done/error | Swallowed (`send`), job still cleaned up, chain continues |
| Engine stream throws mid-chat | `error` for that id; `running` reset; next chat runs |
| Stream ends with `finish_reason:'abort'` without an abort for this id | `error`, never `done` |
| Duplicate id on one port | `error` for the duplicate; the first chat is unaffected |
| Double abort / abort after done | No-op |
| Council (in-page `createPortPair` port) | Same code path via `attachLlmPort`; council's disconnect (`withPort` / `chat` finally) now stops its own job only |

Idempotency/atomicity: all job state lives in one map, updated synchronously in the message handlers; the only
async boundary is the chain, and every step re-checks `job.stopped`. No drift: the global `aborted` set is removed, so
"is this chat stopped" has one source (`job.stopped`).

### Tests (T3.11, `apps/extension/test/ai/llmHost.test.ts`; no real model, no real worker)
Fake engine upgraded: a per-call script of tokens with a controllable gate (a deferred per token, or a short timer),
`interruptGenerate` that ends **whichever** stream is current with `finish_reason:'abort'` (like the real engine),
and counters for `create` calls. Fake port gets a real `onDisconnect` the test can fire; `postMessage` can be set to throw.
1. (existing, updated) load → progress… → ready; status reports the loaded model.
2. (existing, updated) chat → delta… → done; abort of the running chat → fewer than 3 deltas and `error aborted`, no `done`.
3. **H1:** queue A and B on one port (and again on two ports), abort B while A streams → A gets all 3 deltas then
   `done`; `interruptGenerate` not called; B gets `error aborted`; `create` called once. Fails on today's main.
4. **H1 guard:** stream ends with `finish_reason:'abort'` with no abort for that id → `error`, no `done`.
5. **Abort another port's id:** port 2 sends `abort` with port 1's running id → port 1 completes normally, no interrupt.
6. **H2:** A on port 1 streaming with a slow (gated) engine, port 1 disconnects, B sent on port 2 → B's first delta
   arrives while A's remaining tokens were never released; `interruptGenerate` called once. Fails on today's main.
7. **Disconnect while queued:** port 1's chat queued behind port 2's; port 1 disconnects → `create` never called for it;
   port 2 completes.
8. **Abort during load:** port 1 sends load + chat, port 1 disconnects while load is in progress (gated
   `CreateWebWorkerMLCEngine`), port 2 waiting on the same load still gets `ready`; nothing throws; port 1's chat never
   reaches the engine. Plus: abort of a chat id sent while load is pending → no `create` for it.
9. **Lost interrupt:** `interruptGenerate` that does nothing the first time (simulates the reset) → host re-interrupts
   on the next chunk; job ends `error aborted`, the next chat runs.
10. **Errors during cleanup:** `interruptGenerate` throws, and the disconnected port's `postMessage` throws → no
    unhandled rejection; the next chat on a new port completes.
11. **Stream throws mid-chat** → `error` for that id; the next chat completes.
12. **Duplicate id** on one port → `error` for the second, first completes.
13. **M6:** `deleteModelAllInfoInCache` rejects → `error` event; delete of the loaded model → `status.loaded` undefined.
    No GPU (`navigator = {}`) → load gives `error kind:'unsupported'`, status `gpu:false` (H13's llmHost half, cheap).
14. **Council path:** an in-page `createPortPair('llm')` port attached with `attachLlmPort` runs a chat, and its
    `disconnect()` mid-stream stops only its job (another port's chat completes).
Existing council tests (`test/councilHost.test.ts`, `test/council.test.tsx`) must stay green unchanged.
`docs/TESTING.md` T3.11 row gets the new cases appended (no new IDs).

Note for the module-level state: the host keeps state in module globals and tests share one module. Each test unloads
and uses fresh ports; I'll add a test-only `__resetLlmHostForTests()` export only if the existing pattern can't keep
tests independent (prefer `vi.resetModules()` + dynamic import in `beforeEach`).

### Check
`pnpm gate` green. Manual (owner): load Gemma, start an Ask, open a second chat (e.g. council or a second Ask in
another window) and stop one; the other finishes in full. Close the panel mid-answer, reopen, ask again: the answer
starts once the old prompt's prefill is done (seconds; longer on a weak GPU with a big page), not after the old
answer finishes.

## Done
- Tests first: 11 of the 15 new/updated T3.11 cases failed on 77ac925 (H1, H2, lost interrupt, cleanup errors, duplicate id, council port).
- `llmHost.ts`: per-(Port, id) jobs, `stop()` (idempotent; interrupts only the running job), `dropPort()` on
  `onDisconnect` **and** on a throwing post (a Port that dies without onDisconnect still stops its chat), drain with
  re-interrupt, `finish_reason:'abort'` without own abort → error. `attachLlmPort`'s signature is unchanged.
- 16 T3.11 tests, no real model (fake engine + Chrome-like fake Port + the real `createPortPair`). Stable over 5 runs.
- Council: `test/councilHost.test.ts` (incl. T3.31 halt cases) and `test/council.test.tsx`: 36/36 green, unchanged.
- `pnpm gate` green (the one Biome warning is `lib/chatScrub.ts`, already on main).

## Next
- PR #31 open. Lens A r1 APPROVED (2 optional LOWs: L1 duplicate-id comment, L2 interrupt per chunk), to fold together with lens B's findings in one new commit, then send the diff to pe-ed. Waiting on lens B + security.

## Review r1 (folded in one commit after 3ae1b68)
- **Lens B H1 (fixed):** each running job gets an `abandon` reject. `disposeEngine(reason)` fires it, and `create()` and
  every `next()` race it, so unload, delete, a load of another model, or a worker `error` / `messageerror` (new
  listeners, guarded by `worker === w`) ends the chat in `error` and frees the queue. 4 new tests; all 4 fail with the
  abandon line disabled.
- **Lens B L1 (fixed, wording):** the manual check now says "after the old prompt's prefill".
- **Lens B L2 (fixed, differently):** `startLlmHost` accepts only Ports whose `sender.url` is on the extension's own
  origin. Not `sender.tab` as suggested: the options page opens in a tab (`manifest.open_in_tab`) and uses this Port.
  Test: an `https://` sender gets no reply; an options-page sender works.
- **Lens B L3 (not here):** `finish_reason:'length'` → `done` is older than this PR and needs a protocol addition;
  proposed to the orchestrator as a follow-up ticket.
- **PE L1 (fixed):** a comment that ids are unique per Port by the client's contract.
- **PE L2 (not changed):** the re-interrupt is at most one worker message per chunk and the stream ends within a chunk
  or two; throttling would reopen the lost-interrupt window.
- Known, not in scope: a worker crash *during a load* still leaves that load pending (CreateWebWorkerMLCEngine has the
  same no-settle behaviour). Worth a follow-up with L3.

## How to resume
Read this file, then `llmHost.ts` and `test/ai/llmHost.test.ts`. Branch `exec/spc-18`.
