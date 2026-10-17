# SPC-27: harden Inspect's onConnect Port listener

Executor: spc-27-75 · PE: pe-b2 · Orchestrator: specimen-5c · Branch `exec/spc-27` from origin/main b01ea77.
Source: SPC-24 lens-B B-L4 (docs/sprint/handoffs/SPC-24.md "Known limitations"); `councilProtocol.ts` says any
`onConnect` listener that isn't the host must ignore (or disconnect) `council` Ports. No Linear comments.

## Plan (APPROVED by pe-b2, 2026-10-17: disconnect foreign Ports)

### Today
`Toolbar` in `views/Inspect/index.tsx` adds a `runtime.onConnect` listener while Inspect is on. It already returns
early for ports not named `inspector`, but:
1. A foreign Port (`council`, `llm`, anything) is left **open** on this end. Chrome fires the sender's `onDisconnect`
   only when every receiving end has gone, so a live Inspect in another window keeps a crashed council host's Port
   "connected" (panel shows `running`), and if Inspect is the only receiver (e.g. the offscreen host isn't up yet)
   the sender never learns there is nobody there.
2. The `onMessage` listener on an `inspector` Port outlives the effect: after Inspect is toggled off or the view
   unmounts, a late post still calls `setHover` (stale card when re-enabled; setState after unmount).
3. Messages aren't checked: the card does `Object.entries(hover.styles)` and `hover.matchedTokens.map`, so a
   malformed/foreign-shaped message on the port throws during render and takes the panel down.
4. Nothing handles `onDisconnect`: the listener and the port stay referenced.

### Change (one file: `apps/extension/src/entrypoints/sidepanel/views/Inspect/index.tsx`)
- Move the listener into a small pure-ish helper in the same file (or `views/Inspect/inspectorPort.ts` if it reads
  better; still inside `views/Inspect`, which this lane owns): `attachInspector(onHover) → detach()`.
- Foreign Port (name ≠ `inspector`): **`port.disconnect()`** in a try/catch, register nothing, read nothing.
  This only closes Inspect's end; the council host (offscreen) keeps its own end. *PE decision asked: disconnect vs
  ignore-only. I recommend disconnect (it fixes the crashed-host delay the SPC-24 note describes; the protocol
  comment allows it).*
- `inspector` Port: keep it in a `Set`; `onMessage` handler checks a `live` flag and the payload shape
  (`type === 'inspector.hover'`, `rect` numbers, `tag` string, `styles` object of strings, `matchedTokens` array)
  and drops anything else; `onDisconnect` removes both listeners and drops the port from the set.
- `detach()` (effect cleanup, i.e. toggle off / unmount): sets `live = false`, removes the `onConnect` listener,
  removes each port's listeners and disconnects it (try/catch each, so one throwing port doesn't skip the rest),
  clears the set, and `setHover(null)` so re-enabling starts on "Hover an element…".
- No change to the overlay, the message types, the store, the chrome stub, or council code.

### Failure modes
- **Posts after disconnect / after cleanup:** dropped by the `live` flag and by removed listeners (belt and braces:
  Chrome may deliver a queued message after `disconnect()`).
- **Errors during cleanup:** `disconnect()`/`removeListener` on an already-dead port can throw; each is wrapped so
  cleanup always finishes and the `onConnect` listener is always removed (removed first).
- **Idempotency:** `detach()` twice (StrictMode double effects) is a no-op the second time; `onDisconnect` after
  `detach()` is harmless.
- **Concurrency:** a tab reload reconnects a new `inspector` port while the old one is disconnecting: both are
  tracked independently; the latest valid hover wins (as today).
- **Partial failure:** a malformed message is ignored without clearing the last good hover.
- **Drift:** the shape check mirrors `InspectorHover` in `lib/messaging.ts`; typed against that interface so a
  field rename breaks the build, not silently the guard.
- **Council regression:** Inspect disconnecting its end of a `council` Port must not end the run in the sender's
  panel. In Chrome the host's end stays; in tests the council suites don't mount Inspect. I'll run
  `council.test.tsx`, `councilHost.test.ts`, `councilGuard.test.ts` and the full gate.

### Tests (`apps/extension/test/inspect.test.tsx`, new ID **T1.38**, C; T1.37 is taken by PR #46)
The shared stub has no `runtime.onConnect` and `test/helpers/chrome.ts` belongs to PR #40, so the test adds a local
fake `onConnect` + fake Port (name, onMessage, onDisconnect, disconnect spy) onto the installed stub, and makes
`runtime.sendMessage` answer `overlay.set` with `{ ok: true }` so the Inspect button turns on.
- T1.38a foreign Port (`council`, and an unnamed one): Inspect disconnects it, adds no `onMessage` listener, and a
  post on it changes nothing in the card.
- T1.38b `inspector` Port: a valid hover renders; a malformed message (`{type:'inspector.hover'}` without styles,
  and a non-`inspector.hover` type) is dropped, the last good hover stays, no throw.
- T1.38c disconnect mid-stream: fire `onDisconnect`, then post → no throw, card unchanged, listeners removed.
- T1.38d toggle Inspect off (and unmount): the `onConnect` listener is removed, open inspector ports are disconnected,
  a late post is dropped, and re-enabling shows "Hover an element…"; a `disconnect()` that throws doesn't stop cleanup.
- Existing T1.34 (e2e inspector hover) stays green in `pnpm e2e`.
- docs/TESTING.md: add the T1.38 row after T1.36 (+ the "where" table row if the file uses one).

### Owner manual test
Scan a page → Inspect → toggle Inspect, hover elements (card updates) → toggle off/on (card resets) → with Inspect on,
run Ask council in a second window's panel: the council still completes.

## Done
- 2026-10-17: read brief/setup/plan/ticket (no comments); `pnpm i`; plan written.
- 2026-10-17: pe-b2 APPROVED (disconnect foreign Ports; notes a–c folded in: guard checks only what the card reads,
  typed against `InspectorHover`, a test posts the real overlay payload; onConnect removed first and a throwing
  `disconnect()` is tested; a comment by the disconnect says why it is safe).
- Built `attachInspector()` + `isHover()` in `views/Inspect/index.tsx`; 7 T1.38 tests in `test/inspect.test.tsx`
  (local fake `onConnect`/Port; the shared stub is untouched); T1.38 row in docs/TESTING.md.
- `pnpm gate` green locally (gitleaks not installed locally, CI runs it). T1.34 e2e and the council suites green.

## Next / how to resume
PR open → wait for reviews (PE lens A + lens B) under docs/sprint/reviews/, fold findings in new commits.
