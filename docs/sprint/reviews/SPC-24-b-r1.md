# SPC-24 review: lens B + security + privacy, round 1

Reviewer: fresh lens-B reviewer · PR #26 at `ce8bc27` · 2026-10-15 · read-only (this file only).
Read: setup.md, SPC-24-pe-architecture.md, SPC-24 in Linear (all 6 comments), handoff SPC-24.md, CLAUDE.md Rules, `gh pr diff 26`.

**Count: 0 CRITICAL · 1 HIGH · 4 MEDIUM · 5 LOW**

What holds up well: every post to a Port is try/caught and the port is dropped (PE change 1); the key never goes into the
record or into any host → panel/SW message; the host listens only on `onConnect`/`onMessage`, never the `*External` events,
so with no `externally_connectable` web pages can't reach it, and other extensions only reach `onConnectExternal`, which
nothing listens on. `parsePanelMsg` never throws. The offscreen document is never closed (no `closeDocument` anywhere). The
error texts are fixed per kind. The prune happens inside the same transaction as the put.

---

## HIGH

### H1. A host that dies mid-run while a panel is attached leaves the run "running" forever in that panel
`lib/council.ts:122-131` (`interrupt`) plus `:171-184` (`onLost`).
- **Failure.** The panel's in-memory record gets `updatedAt` only from a `snapshot` (at start or attach). `turn` deltas
  never update it, but the host bumps `record.updatedAt` and `put`s on every ended turn (`councilHost.ts:137-140`).
- **Scenario.** The panel is open and the council is at turn 3. The offscreen document crashes, or the user reloads the
  extension from chrome://extensions, which kills both, so take the crash case. The Port disconnects and `onLost` calls
  `interrupt(rec)`. Then `markInterrupted(runId, staleUpdatedAt)` sees a mismatch, because the host wrote turns 1–2, and
  returns null. `latestRun()` returns the stored record, still `running`, and the panel shows it. The result:
  - The mascot thinks forever.
  - Start is blocked (`startCouncil` returns early on `status === 'running'`).
  - Stop does nothing (`port` is null; `stopCouncil` swallows it).
  - Only closing and reopening the panel recovers.

  The conditional write meant to protect a live host here blocks the one case where we *know* the host is gone. No test
  covers a disconnect after a turn has been stored (the T3.32 reattach cases all start from a fresh DB record).
- **Fix.** Either:
  - keep `updatedAt` in step: add `updatedAt` to the `turn` delta (a contract change, PE call), or have the panel re-read
    the stored record before the conditional write, or
  - in `interrupt`, when the caller *knows* the host is gone (onLost, no offscreen, unknown runId), retry once with the
    stored `updatedAt` if the stored record is still `running` with the same runId.

  Test: attach, let the host store two turns, disconnect the fake port. The panel shows `council-interrupted` and the DB
  says `interrupted`.

---

## MEDIUM

### M1. A key, provider or flag change between the panel reading the config and the host starting isn't halted
`councilHost.ts:79-123, 189-191`; `Council.tsx:240-247`.
- **Failure.** `halt(at)` acts only on a `live` run with `startedAt <= at`. `startedAt` is host time, taken *after*
  `await makeProvider`. The panel resolved the key earlier: `resolveProviderSpec`, then `offscreen.ensure`, which can
  create the document, then connect and post.
- **Scenario.** The user clicks "Ask the council" (old key read at t0), then quickly removes or rotates the key, or turns
  the Labs flag off, in Options at t1. At t1 the SW sends `halt{at:t1}`, but `live` is still null, so it's ignored. The
  host then accepts the start at t2 > t1, and the halt-order rule would ignore it anyway. The whole run (up to 10 calls)
  goes to the old provider with the old key, or **runs with the flag off**. The window is the `offscreen.ensure` plus
  `makeProvider` time: usually small, but a first-time document creation makes it hundreds of ms.
- **Fix.**
  - Put `resolvedAt` (the panel's `Date.now()` when it read settings and key) in `start`.
  - The host keeps `lastHaltAt` (set even when no run is live).
  - Reject a start whose `resolvedAt <= lastHaltAt`, with a fixed "settings changed, start again".
  - Compare `halt.at` against `resolvedAt`, not `startedAt`.

  This adds a field to frozen contract v1, so it's a PE call. Test both orders in T3.31.

### M2. A failed final write shows a ✓ badge, then an "interrupted" run with the verdict lost
`councilHost.ts:152-164`.
- **Failure.** When both final `put`s fail (quota, or the DB blocked), the host still sends `status{done}` and
  `council.finished{done}`, so the SW sets ✓. It then sets `live = null` and drops the result from memory.
- **Scenario.** The panel is closed and the disk is near quota. The badge shows ✓ and the user opens the panel.
  `latestRun()` returns `running` (the last turn write) and the panel reattaches. The host answers `snapshot{null}` and
  the panel marks the run `interrupted`. The user paid for the run, saw "ready", and gets "interrupted" with no verdict:
  a misleading success. The handoff calls this case "honest, not silent", but the badge says otherwise.
- **Fix.**
  - The host keeps the last finished record in memory (`lastFinished`) and answers `attach` with it when nothing is live.
    The panel then shows it (and may try the write itself).
  - Send `council.finished` with `status: 'error'` (or a `stored: false` flag) when the final write failed, so the badge
    is `!`.

  Test: `put` rejects twice on the final write, then attach. The verdict is shown and the badge isn't ✓.

### M3. Privacy: the goal text, host and discussion stay on disk with no way to clear them, even after flag-off or scan deletion
`councilDb.ts` (no delete path); `lib/db.ts:122` `deleteScans` doesn't touch `specimen-council`.
- **Failure.** Each record holds the user's free-text goal (up to 1000 chars), the scanned host, every turn (quoting
  measured values) and the verdict. The last 5 are kept indefinitely.
- **Scenario.** A user tries the council on a client's staging site with a goal that names the client's product plans,
  then turns the Labs flag off and deletes the scan from the Library. The goal text and the host stay in IndexedDB, and
  nothing in the UI shows or removes them.
- **Fix.** Clear `specimen-council` (and `council.seen`) when the flag goes off: the SW guard already sees that change.
  Delete runs whose `scanId` is deleted in `deleteScans`, or add a "Clear council history" link on the finished card. Say
  in the setup privacy line that the last 5 runs, with the goal, are kept on this device. Test: flag off → `countRuns()`
  is 0.

### M4. A second panel (another window) never learns about a run started elsewhere, and doesn't learn when it ends
`lib/council.ts:221-248` (`probe` drops the port when there's no live run), `:189-218`.
- **Scenario.** Panels are open in windows A and B, with B on the council tab showing an old finished verdict. A starts a
  run. B's probe port was dropped at mount (`snapshot{null}`), so B gets no snapshot or turns. Its mascot stays idle or
  happy on the old run, and the Start button looks available. Clicking it gets the live snapshot (fine), but until then B
  is wrong. The same goes for a run that A started and that finishes: B doesn't update until it remounts. The PE's §3
  says "two windows' panels both attach to the same run".
- **Fix.** Keep the probe port open (don't drop it on `snapshot{null}`; the host already broadcasts the start
  `snapshot`). Or have the panel listen for `council.started`/`council.finished` runtime messages, which are already
  broadcast to every extension page, and re-run `initCouncil`'s read and reattach. Test: two fake panels, start from one,
  and the other shows `running`, then `done`.

---

## LOW

### L1. The badge can stick at ✓ after the verdict was already seen (a race)
`councilGuard.ts:66-79`.
- **Scenario.** The panel is open on the council tab when the run ends. The host broadcasts `status` and *then* sends
  `council.finished`. The panel's `markSeen` → `storage.local.set` → `onChanged` can reach the SW before the finished
  message: the badge clears, then ✓ is set. `seen` already equals the runId, so nothing clears it until the next run.
- **Fix.** In `onRuntime(finished)`, read `council.seen` first and skip the badge if it equals `runId`. Or have the panel
  clear the badge itself with `chrome.action.setBadgeText` in `markSeen`.

### L2. Stop during provider setup is silently dropped
`councilHost.ts:180-181`.
- **Scenario.** While the host awaits `makeProvider` (e.g. the Chrome built-in availability check), `live` is null and a
  `stop{runId}` is a no-op. The run then starts. The UI is in `starting`, so Stop is probably hidden; the gap is small.
- **Fix.** Remember a stopped runId (a `Set` or the last one) and reject a start that matches it.

### L3. A reattach timeout can mark a live run interrupted, then the host overwrites it
`council.ts:144-149`.
- **Scenario.** The offscreen page is slow to answer `attach` (more than 3 s, e.g. a busy main thread during a WebLLM
  load on a weak machine). The panel writes `interrupted` (the conditional matches), then the host's next turn `put`
  overwrites it with `running` and later `done`. This panel shows "interrupted" for a run that finished; badge ✓.
- **Fix.** When a late `snapshot` arrives for the same runId after the timeout, apply it (the run is live) instead of
  ignoring it.

### L4. Any extension page that has an `onConnect` listener receives the `council` Port, and so the `start` with the key
`entrypoints/sidepanel/views/Inspect/index.tsx:30-35`.
- **Today:** Inspect checks `port.name !== 'inspector'` and adds no `onMessage`, so nothing reads the key, and other
  extensions and web pages can't reach `onConnect`. But Chrome keeps the Port alive while *any* receiver holds it, so:
  - with an Inspect listener live in another window's panel and the offscreen document crashed, the panel's
    `onDisconnect` may never fire (feeding H1's stuck state);
  - a future `onConnect` listener that logs messages would get the key.
- **Fix.** In Inspect's listener, call `port.disconnect()` on any port that isn't `inspector`, which releases only that
  receiver's end. Add a comment in `councilProtocol.ts` saying no other extension page may read `council` Port messages.
  Optional hardening: send the key only after the host acknowledges.

### L5. The "earlier scan" note names the old host even when the current scan is a different site
`Council.tsx:376-378`.
- **Scenario.** The old run was for `a.com` and the current scan is `b.com`. The note reads "This verdict is for an
  earlier scan of a.com", which reads as if `a.com` is the current site.
- **Fix.** When the hosts differ: "This verdict is for a.com, not the current scan." When they're the same: "for an
  earlier scan of this site".

---

## Checked, no finding
- **The key:** absent from `CouncilRecord`, `snapshot`/`turn`/`status`/`rejected`, `council.started/finished`, and the
  fixed error texts. No `console.*` in any new file. It's held in the `start` closure and the provider only until the run
  ends.
- **The sanitizer:** turns and the summary are sanitized in the engine, and the verdict is parsed from sanitized text. The
  UI renders text nodes only (no `dangerouslySetInnerHTML`).
- **The goal text:** outside `<page_data>`, never in the system prompt, clipped to 1000 with control characters removed.
  It's the user's own text going to the user's provider. Not sanitizing it is stated and acceptable.
- **The flag off:** the Council view and the mode switch aren't rendered; nothing is sent. M1 is the only path where a run
  can begin after the flag goes off.
- **The SW asleep:** `storage.onChanged`, `onStartup`, `onInstalled` and `listen` are all registered synchronously in
  `defineBackground`, so the events wake the SW.
- **Extension update or reload mid-run:** `onInstalled` → `interruptAllRunning` and the badge `!`, which is fine. A panel
  open across a reload is H1.
- **429 or timeout in the background:** the engine's single-`setTimeout` waits and the stall timer, and `halt`/`stop`
  abort them. The countdown reaches a reattached panel through the next `turn` delta.
