# SPC-24 handoff: Council v2 (merge Ask + Council, background run, mascot status, verdict-only report)

Executor: spc-24-3e · Branch: exec/spc-24 (from exec/spc-22, PR #25's code) · Lane C · Sprint 2 · PE: pe-1b ·
Orchestrator: specimen-53

## Plan (PE pe-1b approved 2026-10-15 with changes 1–7, folded in under "PE changes")

### Scope (owner's 6 requirements, SPC-24)
1. One tab: Ask gets a mode switch **Quick answer | Ask the council**. The Critique tab goes away.
2. A **context box** (what you're building, for whom, what you care about) that every reviewer gets as the user's goal.
3. The council **runs in the background**: closing the side panel or browsing elsewhere doesn't stop it. Still
   abortable, still under the cost cap and Groq pacing.
4. The **mascot shows status**: `thinking` while running, `happy` ("ready") when a verdict is waiting. Clicking it opens
   the result. Reopening the panel shows the finished verdict.
5. The output is **the verdict only**: verdict line, what works (with scan numbers), what to change (concrete), where
   the reviewers disagreed. **No generated prompt.**
6. **"Show discussion"**: a small link, closed by default, that reveals the reviewers' turns.

Unchanged from SPC-22: the Labs flag `flags.critique` (off by default, same Options `?labs=1` card), `compactScan`
in `<page_data>`, the sanitizer on every turn and on the verdict, `LLMProvider` only, Groq pacing + retries + stall
timer, fixed per-kind error text, mock provider in tests, no `site/` change, no `DesignScan` change, no new
permission, no CWS release (the owner tests the branch build; nothing merges before the owner's go).

### Architecture: the PE's decision (`worktrees/pe/docs/sprint/reviews/SPC-24-pe-architecture.md`), adopted
I first drafted a service-worker runner with a keepalive; the PE's offscreen-document design is safer (no eviction
mid-wait) and I follow it. How I'll build each point, plus where I need a ruling (marked **Q**):

**Host.** `entrypoints/offscreen/councilHost.ts`, started from `offscreen/main.ts` next to `startLlmHost()`. It owns
one `AbortController` and runs `runCritique` on the main thread. Reason stays `WORKERS`; justification unchanged.
- **BYOK** is built in the host from `provider: { kind: 'byok', cfg: { preset, baseUrl, model, apiKey?, vision } }`
  with the same `resolveByokProvider` (moved React-free into `lib/aiByok.ts`, which it already is). The host
  re-validates `preset` against `getPreset()`.
- **WebLLM** (`{ kind: 'webllm', cfg: { modelId, contextTokens } }`): `chrome.runtime.connect` from a page never
  reaches its own `onConnect`, so the host can't use the normal Port. I'll split `llmHost.ts`'s connect handler into
  `attachLlmPort(port)` and give `createWebLLMProvider` an in-memory `PortLike` pair (`lib/localPort.ts`) wired to it.
  Same queue, same engine, no second engine.
- **Chrome built-in** (`{ kind: 'chrome' }`): the host checks availability; if it's missing the start is rejected with
  the fixed text "The council needs a local Gemma or an API key provider" (tested). The panel shows it on the setup
  card.
- **Hidden-page timers:** our waits are single `setTimeout`s (pacing, retry, stall), never chains, so Chrome's
  intensive throttling of chained timers in hidden pages doesn't apply. Checked in T3.27 by closing the panel during a
  pacing wait.

**Key.** The panel already holds the resolved, unlocked config (`useAi`); I add a small `providerSpec()` next to
`resolveAi()` that returns the `{kind, cfg}` for the start message (the key read from `loadKey` at Start time, not
cached in the panel). The host keeps it in the run's closure only and drops it when the run ends. It never appears in
the record, in any host → panel message, in `council.finished`, in an error or a log. T3.32 serializes all of those
with a fake `sk-test-FAKEFAKE…` key and asserts it's absent.

**Record** (separate Dexie DB `specimen-council`, table `runs`, keyed by `runId`, index `updatedAt`):
```ts
interface CouncilRecord { v: 1; runId: string; scanId: string; scanHost: string;
  status: 'running' | 'done' | 'stopped' | 'error' | 'interrupted';
  plan: { personas: PersonaId[]; rounds: number; totalTurns: number; providerLabel: string };
  context: string; turns: CritiqueTurn[]; verdict: Verdict | null; summaryText?: string;
  error?: string; startedAt: number; updatedAt: number }
```
- One atomic `put` per turn end and per status change; the same `rw` transaction prunes to the newest 5. Streaming
  snapshots and waiting countdowns go over the Port only (not stored).
- `scanHost` is shown in the panel only (the scan library already stores hosts); it is never sent to the model.
- **"Seen"** (for the ready mood and the badge) is not in the record, so the record has one writer (the host, plus
  the panel/SW only for the `interrupted` fix-up below): `chrome.storage.local` key `council.seen = runId`, written
  by the panel when it shows a finished verdict. The SW clears the badge on that `onChanged`.

**Port `council`, contract v1 (PE §6), plus three clarifications (Q1–Q3):**
- Panel → host: `start{ v, runId, scan, provider, personas, rounds, context }` · `stop{ runId }` · `attach{}`.
- Host → panel: `snapshot{ record | null, live?: LiveTurn }` · `turn{ runId, index, turn }` ·
  `status{ runId, status, verdict?, error? }`.
- Host → SW: runtime message `council.finished{ runId, status }`.
- **Q1:** a `start` while a run is live answers `snapshot` of the live run (PE: "returns the live run"), and the panel
  shows "A council is already running". I add nothing to the contract for this.
- **Q2:** a `start` the host rejects (bad `v`, malformed, unsupported provider, unknown preset) → `status{ runId,
  status: 'error', error: <fixed text> }` with nothing stored. Is reusing `status` for that OK, or do you want a
  separate `rejected{ runId, error }`?
- **Q3:** the retry/pacing countdown is a `turn` snapshot (`status: 'waiting'`, `retryInMs`), as in SPC-22, so a
  reattached panel sees it in the next `turn` message. No new message type.

**Reattach.** The panel reads the newest record from the DB on mount (`useCouncil()` in `lib/council.ts`).
- If it's `running`: `send('offscreen.ensure')` is **not** called (that would create a fresh, empty host). The
  panel checks `chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})`: none → mark `interrupted`. Else it
  connects the Port and sends `attach`; a `snapshot` whose `record.runId` differs (or is null), or no answer within
  3 s, or an immediate disconnect → mark `interrupted`.
- The `interrupted` write is conditional: one `rw` transaction that re-reads the record and writes only if it's still
  `running` with the same `updatedAt` (so a live host that just wrote a turn is never overwritten).
- **SW:** `chrome.runtime.onStartup` and `onInstalled` mark `running` records `interrupted` (the offscreen document
  can't survive either), and set the `!` badge.
- Start: the panel calls `send('offscreen.ensure')` first, then connects and sends `start`.

**Guards in the SW** (`lib/councilGuard.ts`, registered in `background.ts`; wakes on `storage.onChanged`):
- `flags.critique` becomes anything but `true` → stop.
- `settings.ai` changed: compare old/new fingerprints (`provider`, `byok.preset`, `byok.baseUrl`, `byok.model`,
  `webllmModel`) → stop if different. A change to only `downloaded` or `encryptKeys` doesn't stop. (This is the
  SPC-22 webllm-reload exemption: a model reload doesn't touch settings.)
- Any `secrets.*` change → stop. The session vault key removed (locked) → stop; set (unlocked) → no stop.
- "Stop" from the SW = runtime message `council.halt{}` that the host listens for (`chrome.runtime.onMessage` in the
  offscreen page, which ignores every other type). If no offscreen document exists it isn't sent. The host aborts
  whatever run is live; there is no runId because the SW doesn't track runs (Q4: OK?).

**Badge.** On `council.finished`: `✓` done, `!` error/interrupted, nothing for stopped (the user did that). Cleared
on `council.seen` and when a new run starts. `chrome.action.setBadgeText` needs no permission.

### Verdict format (engine, `packages/ai/src/features/critique.ts`)
- The summary brief changes from keep/change to:
  ```
  Verdict: <one or two sentences>
  Works:
  - <up to 5, each with a measured value>
  Change:
  - <up to 5, concrete: what → to what, with the measured value>
  Disagreed:
  - <up to 3 points where the reviewers disagreed, or "- None">
  ```
- `parseVerdict(text): Verdict | null` with `Verdict = { verdict: string; works: string[]; change: string[];
  disagreed: string[] }`. Same lenient rules as `parseKeepChange` after the A-M1 fix (heading = the word alone or
  with a colon; `-`/`*`/`1.` bullets; case-insensitive; "None" → empty list). Null (raw text shown) unless it finds
  the verdict line and at least one of works/change. `parseKeepChange` and `KeepChange` are removed (PR #25 never
  merged, so no consumer).
- The verdict is built only from the sanitized summary text. The report has a **Copy report** button (plain text of
  the four sections). No prompt is generated anywhere.
- `CritiqueResult.summary` becomes `verdict: Verdict | null`, and the result also returns `summaryText` for the
  fallback.

### Mascot and click-to-reopen
- Header mascot mood: `scanning` while scanning (as now), else `thinking` while the newest record is `running`, else
  `happy` (the existing mood is the "ready" look) when the newest record is `done` and `council.seen !== runId`, else
  `idle`. No new art; `components/Mascot.tsx` gets no new mood, and `design/logo/final/specimen-critter.svg` is
  untouched. Only with the flag on.
- When thinking or ready, the mascot is wrapped in a `<button>` (`aria-label` "Council is thinking, open it" /
  "Council verdict ready, open it"; the SVG stays `aria-hidden`). Click → Ask tab, council mode. Idle → decorative,
  not a button.
- Viewing a finished record in the council view writes `council.seen = runId` (the badge clears, the mood returns to
  idle).

### Context box
- A textarea above Start: "What are you building, for whom, and what matters to you?" Optional (empty → the line "The
  user gave no goal"), **max 1000 chars** (PE §7): `maxLength` in the UI and a hard clip in the engine (trimmed,
  control chars except `\n` removed, clipped).
- Engine: a new `context?: string` option. In every call's **user message**, before the transcript, as
  `[Goal]: <context>` with one line saying it's the user's own goal. Outside `<page_data>` (user text, not page data)
  and not in the system prompt (the cacheable system prefix from B-L3 stays identical). The briefs say "weigh the
  user's goal". It always survives the budget trimming; the 2000-char floor still fits (1000 + instruction ~300).
- Stored in the record; the box is prefilled from the newest record.
- Not sanitized (it's the user's own words to the user's chosen provider; sanitizing would garble it). The output is
  sanitized as now. Stated in the PR.

### UI (Ask tab)
- `views/Ask.tsx` gets a small segmented switch at the top, only when the flag is on: **Quick answer** (today's Ask,
  untouched) | **Ask the council**. Flag off → exactly today's Ask; the Critique tab is gone.
- `views/Council.tsx` (replaces `Critique.tsx`), driven by `useCouncil()` (newest record + Port deltas):
  - **Setup:** no scan / no provider → the same states as Ask (`SETUP_HINT`, Open Settings); Chrome built-in → "needs
    a local Gemma or an API key". Otherwise: the context box, reviewer toggles (2–3 of 4), rounds (1–3), the cap line
    (calls · token range · pacing), **Ask the council**, and "You can close the panel. The mascot shows when the
    verdict is ready."
  - **Running:** "The council is discussing… Turn 3 of 7 · Groq", the waiting/rate-limit countdown when there is one,
    **Stop**. "Show discussion" (closed) reveals the live turns.
  - **Done:** the report card (Verdict, What works, What to change, Where they disagreed, Copy report), a header
    "Council verdict · <host> · <time>", "Show discussion" (a native `<details>`, closed by default), **Start again**.
  - **Stopped / error / interrupted:** a one-line fixed reason, the turns so far behind "Show discussion", **Start
    again**.
- **Stale verdict for a different scan:** if `record.scanId !== scan.id`, the report still shows, with the note "This
  verdict is for an earlier scan of <host>" and **Ask about the current scan**. No current scan → the verdict still
  shows. Older runs (up to 5) aren't listed in the UI for now.
- `views/critiqueStore.ts` and the panel-side `guardProvider`/flag reset go (the SW guards replace them).
- `store.ts`: `TabId` loses `'critique'`; `askMode: 'quick' | 'council'` lets the mascot click switch to it.

### Files
- `packages/ai/src/features/critique.ts` (+ test): `context`, the verdict brief, `parseVerdict`, `Verdict`, drop
  `parseKeepChange`/`KeepChange` (never merged). `packages/ai/src/index.ts` exports.
- `apps/extension/src/lib/councilProtocol.ts`: the v1 Port contract types + `parsePanelMsg()` (rejects bad `v` or
  shape with a fixed error) + `PORT = 'council'`.
- `apps/extension/src/lib/councilDb.ts`: the `specimen-council` Dexie DB, `putRun` (put + prune to 5 in one tx),
  `latestRun`, `markInterrupted(runId, updatedAt)` (conditional, one tx), `interruptAllRunning()`.
- `apps/extension/src/lib/council.ts`: `useCouncil()` (read + reattach + Port), `moodFor()`, `providerSpec()`.
- `apps/extension/src/lib/localPort.ts`: the in-memory `PortLike` pair for WebLLM inside the offscreen page.
- `apps/extension/src/lib/councilGuard.ts`: the SW's `storage.onChanged` guard + badge logic (pure function of the
  change + injected `halt`/`badge`).
- `entrypoints/offscreen/councilHost.ts` (+ `main.ts` start); `llmHost.ts`: export `attachLlmPort(port)` (no
  behaviour change).
- `entrypoints/background.ts`: the guard listener, `council.finished` → badge, `onStartup`/`onInstalled` →
  `interruptAllRunning()`.
- `lib/messaging.ts`: `council.finished`, `council.halt`.
- `sidepanel/App.tsx` (mascot button + mood; drop the Critique tab and panel guards), `store.ts`, `views/Ask.tsx`,
  `views/Council.tsx`.
- Tests: `packages/ai/src/features/critique.test.ts`, `apps/extension/test/councilHost.test.ts`,
  `apps/extension/test/councilGuard.test.ts`, `apps/extension/test/council.test.tsx` (replaces
  `critique.test.tsx`).
- `docs/TESTING.md`: new IDs T3.28–T3.33; T3.26 is rewritten as the v2 component test or retired in favour of T3.33
  (your call); T3.27's text updated to the SPC-24 owner check.

### Tests (mock provider, fake-indexeddb, fake chrome events/ports; no network)
Engine (tests first):
- **T3.28 U context:** `[Goal]:` reaches every call's user message (personas and summary), outside `<page_data>`,
  clipped to 1000 with control chars removed; the system prompt is byte-identical with and without context; the goal
  survives trimming at `contextTokens` 2048; empty → the "no goal" line.
- **T3.29 U parseVerdict:** well-formed; variant headings/bullets; "None" → []; no verdict line → null; prose starting
  "Works…"/"Changes like…" isn't a heading; sanitized before parsing (brand gone, hex/px survive).
Host (`councilHost` driven with a fake port pair + mock provider + fake-indexeddb + fake timers):
- **T3.30 U background run:** start → `running` record → one put per turn end → `done` with a verdict; the panel's
  port disconnects mid-run and the run still finishes `done` (panel closed); a second port that `attach`es mid-run gets
  the live snapshot then deltas; a second `start` while live → the live run's snapshot, no extra calls; prune leaves
  exactly 5; `council.finished` sent with `{runId, status}` only.
- **T3.31 U stop + guards:** `stop{runId}` → no more calls, `stopped`; a stop with another runId → no-op; `halt` (SW)
  with no panel attached → stopped, no more calls; the abort paths during a pacing wait and a retry wait. Guard
  (`councilGuard`, fake `onChanged` events): flag → off sends halt; a settings fingerprint change sends halt; only
  `downloaded` changed → no halt; a `secrets.*` change → halt; vault lock → halt, unlock → no halt; no offscreen doc →
  nothing sent. Badge: `✓` on done, `!` on error/interrupted, none on stopped, cleared on `council.seen`.
- **T3.32 U failures + key hygiene:** a provider error → `error` with fixed text, no summary; bad `v` / malformed /
  unknown preset / Chrome built-in unavailable → rejected with a fixed error, nothing stored, no call; a fake key
  `sk-test-FAKEFAKE…` (also inside a provider error message) is absent from every message the host sends, every stored
  record and `council.finished`; reattach: no offscreen document → `interrupted`; unknown runId → `interrupted`; no
  answer in 3 s → `interrupted`; the conditional write doesn't overwrite a record the host updated meanwhile; SW
  `onStartup`/`onInstalled` → all `running` records `interrupted`.
Component:
- **T3.33 C Ask + council:** flag off → no switch, no Critique tab; flag on → the switch; no provider → the setup
  hint; the context limit; Start sends `start` with the context and the provider spec; renders running + Stop, done
  (report with "Show discussion" closed, then open), error, interrupted; the mascot mood follows the record
  (thinking → happy → idle after seen) and a click opens Ask/council; a verdict for another scan shows the
  "earlier scan" note; the report has no prompt text and no copy-prompt button.
- **T3.27 🖐 Owner (updated):** the ticket's "How to check" with Groq in the branch build, including closing the panel
  during a pacing wait.
- No Playwright e2e: the real offscreen + SW path is the owner's T3.27; adding a mock-provider hook to the shipped
  offscreen page isn't worth it.

### Failure modes (summary)
| Case | Behaviour |
|---|---|
| Panel closed mid-run | The host keeps running; record per turn; badge on finish; reopening reattaches |
| Offscreen doc dies (crash, extension reload/update, browser restart) | `interrupted` on reattach (no doc / unknown runId / no answer) and on SW `onStartup`/`onInstalled`; no auto-resume (cost) |
| Provider error (auth/network/other) | `error`, fixed text, no summary, turns kept |
| Groq 429 | Unchanged pacing and 3 retry waits, each Stop-cancellable; countdown as a `turn` delta |
| Stall | Unchanged: 120 s first / 30 s gap → `error` |
| Flag off / provider or key change mid-run | SW guard → `halt` → no more calls, even with no panel open |
| Scan change | Not stopped (the run has its copy of the scan); verdict labelled with its host; "earlier scan" note |
| Two panels / double Start | One host, one run; the second `start` gets the live snapshot |
| DB write fails mid-run | The run continues (the Port still carries deltas); the final put is retried once; if it still fails the record stays `running` and is marked `interrupted` on the next reattach (honest, not silent) |
| Interrupted fix-up races a live host write | Conditional write on `updatedAt`, one transaction |
| Malformed / wrong-version message | Rejected with fixed text, never thrown in the host |
| WebLLM | Same `llmHost` queue via an in-memory port; SPC-18 limits still apply |

### PE changes (approval conditions, 2026-10-15). These win over anything above.
Answers: Q1 OK; Q3 OK; Q2 → item 2; Q4 → item 3. The in-memory port to llmHost, `council.seen` in storage.local and
T3.28–T3.33 are OK.
1. **A closed panel never kills the run.** Chrome throws on `postMessage` to a disconnected Port. The host wraps every
   post in try/catch and drops that port on a throw and in `onDisconnect`. The engine's `emit` guards `onTurn` (a
   throwing callback never breaks a turn). Every fire-and-forget `put` has a `.catch`. Tests: T3.30's fake port throws
   on post after disconnect (as Chrome does) and the run still ends `done`; an engine case in `critique.test.ts`
   (`T3.30 engine: a throwing onTurn never breaks a turn`) → every turn still `done`, same call count.
2. **Q2 → `rejected{ runId: string | null, error }`** (host → panel), added to the frozen v1 contract. A malformed start
   may have no runId (null). `status{error}` is only for a stored run failing.
3. **Q4 → `council.halt{ at }`** with the change time (`Date.now()` in the SW when the `onChanged` fired). The host
   ignores it when the live run's `startedAt > at`, so a key change followed by a quick Start can't kill the new run
   that already uses the new key. T3.31 tests both orders (halt before start → ignored; start then halt → stopped).
4. **Badge on a new run:** host → SW runtime message `council.started{ runId }`, sent when a run is accepted; the SW
   clears the old `✓`/`!`. Added to the contract (beside `council.finished`). Tested in T3.31 (badge cleared on
   started) and T3.32 (the started message carries no key).
5. **TESTING.md:** T3.25 and T3.26 become ⊘ (`**Dropped 2026-10-15** (replaced by T3.29 / T3.33, SPC-24)` plus the
   struck-through original). IDs are never reworded. T3.18–T3.24 stay (the engine keeps those behaviours). Run
   `check-ids --all`. T3.27's owner row is updated in place only if it keeps its meaning (an owner Groq run); otherwise
   a new ID. (I'll keep T3.27 as the SPC-22 check and add the SPC-24 owner check as **T3.34 🖐**.)
6. **`attachLlmPort` is a pure refactor:** the existing T3.11 llmHost tests pass unchanged (no edits to them). The PR
   says that with WebLLM a quick Ask queues behind each council turn (same `chatChain`).
7. **Privacy line:** the setup text and the footer say each turn sends the measured values **plus the user's goal
   text** to <provider>, and that the run continues with the panel closed.

Frozen contract v1, final:
- Panel → host (Port `council`): `start{ v, runId, scan, provider, personas, rounds, context }` · `stop{ runId }` ·
  `attach{}`.
- Host → panel: `snapshot{ record | null }` · `turn{ runId, index, turn }` · `status{ runId, status, verdict?,
  error? }` · `rejected{ runId | null, error }`.
- Host → SW (runtime): `council.started{ runId }` · `council.finished{ runId, status }`.
- SW → host (runtime): `council.halt{ at }`.

### Known limitations (unchanged)
- Sanitizer camelCase gap (SPC-17); WebLLM interrupt limits (SPC-18); TPM keyed by provider, not model (A-r2 L1).
- The flag ships in any release built from `main` with this code, so the owner's rule stands: no merge before go.

## Done (2026-10-15)
- Plan approved by pe-1b with changes 1–7 (folded in above). PE handed over to pe-99.
- Engine (`packages/ai/src/features/critique.ts`): `context` → `[Goal]` in every user message (clipped to 1000,
  control chars removed, never in the system prompt); verdict brief + `parseVerdict` (`Verdict`); `CritiqueResult`
  has `verdict` + `summaryText`; `emit` guards a throwing `onTurn`. `parseKeepChange` removed. Tests T3.28–T3.29 and
  the T3.30 engine case; T3.18–T3.24 unchanged and green.
- Extension:
  - `lib/councilProtocol.ts` (v1 contract, `parsePanelMsg`, fixed rejection texts), `lib/councilDb.ts`
    (`specimen-council` DB, put + prune to 5, conditional `markInterrupted`, `interruptAllRunning`),
    `lib/localPort.ts` (in-memory Port pair), `lib/councilGuard.ts` (SW guard + badge), `lib/council.ts` (panel
    store: reattach, probe, start/stop, seen, `moodFor`), `resolveProviderSpec()` in `lib/aiRuntime.ts`.
  - `offscreen/councilHost.ts` + `main.ts`; `llmHost.ts` gets `attachLlmPort` (pure refactor, T3.11 unchanged).
  - `background.ts`: guard on `storage.onChanged`, `council.started/finished` → badge, `onStartup`/`onInstalled` →
    interrupted. `messaging.ts`: the two runtime messages.
  - Side panel: Ask's "Quick answer | Ask the council" switch (flag on only), `views/Council.tsx`, header mascot
    mood + click-to-open, `askMode` in the store. `Critique.tsx`, `critiqueStore.ts` and `test/critique.test.tsx`
    removed.
- Found while testing, fixed: a panel reopened right after Start could read the store before the host's first write.
  The host now awaits its first write before the first call, and the panel also asks a live host for its run when
  the store shows none (covers failing writes too; tested).
- Tests: `test/councilHost.test.ts` (T3.30–T3.32), `test/councilGuard.test.ts` (T3.31–T3.32),
  `test/council.test.tsx` (T3.32–T3.33). `docs/TESTING.md`: T3.25/T3.26 ⊘, T3.28–T3.34 added.

## Next
- `pnpm gate` green (2026-10-15). PR #26 is open (base main, owner steps = T3.34 in the body). The link is on SPC-24,
  and specimen-53 and pe-99 have been told. Waiting for reviews (PE lens A, lens B + privacy). Not to be merged
  before the owner's go.

## How to resume
Branch `exec/spc-24` in `worktrees/spc-24`. Read this file, then `docs/sprint/reviews/SPC-24-*` for findings; fix in
new commits, rerun `pnpm gate`, tell the reviewer what changed.
