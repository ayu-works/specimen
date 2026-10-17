# SPC-27 review: lens B, round 1

PR #50 (`exec/spc-27` @ 2395761). Reviewer: lens B (fresh, read-only). Focus: how Chrome Ports really behave.

**Verdict: CHANGES REQUESTED.** 1 CRITICAL · 1 HIGH · 2 MEDIUM · 3 LOW.

## What Chrome actually does (the premise of the change)
From the Chrome docs, [Message passing → Port lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/messaging):
- `runtime.connect()` fires `runtime.onConnect` "once for every frame in the extension process" that has a
  listener: every side panel (one per window), the offscreen document and the options page. The calling frame
  is the only one left out.
- `onDisconnect` fires at the sender when the other end calls `disconnect()`. The docs also say: *"If a connect()
  call results in multiple ports at the receiver's end, and disconnect() is called on any of these ports, then
  the onDisconnect event only fires at the sending port, and not at the other ports."*

So one receiver calling `disconnect()` closes the channel **for the sender**. The other receivers get no
notice, and their end is left dead. This matches Chromium, where an explicit `disconnect()` is a force-close of
the channel, while a frame unloading only removes that one frame. The comment the PR adds, *"each receiving frame
has its own end, so this only closes ours (the council host keeps its)"*, is wrong, and so is the handoff's claim
that it is safe. The test fake (`hub` + `fakePort`) has a single receiver, so it can't show this.

---

## CRITICAL

### B-C1: disconnecting foreign Ports ends other windows' council runs and local-model calls
`views/Inspect/index.tsx:57-61`

**Scenario (council):** two windows each have the side panel open, and Inspect is on in window B. In window A
the user clicks Ask council. `lib/council.ts:openPort()` calls `runtime.connect({name:'council'})`, and
`onConnect` fires in the offscreen host *and* in panel B. Panel B calls `port.disconnect()`, which closes the
channel. A's `p.onDisconnect` fires `onLost(p)` (`council.ts:245`): if `start` is still pending, the user sees
`LOST_HOST` ("rejected"); if the run is already going, `interrupt(rec, true)` marks it `interrupted` in storage.
Meanwhile the offscreen host keeps its end and gets no `onDisconnect`, so it may keep running the critique and
writing turns. The user sees a run "interrupted" that the host is still spending tokens on. Panel A's long-lived
Port is now gone, and every later `start` from A has the same race with B's Inspect. Before this PR, Inspect
ignored the Port and A's run worked.

**Scenario (local model):** with Inspect on in window B, any WebLLM call from panel A, or from the options page
(model test or download), opens `llm` (`packages/ai/src/providers/webllm.ts:22`). Panel B disconnects it, and A's
`onDisc` fails the call with *"The local model process went away. Try again."* every time. `llmHost`
(`offscreen/llmHost.ts:340`) leaves the request running, which wastes GPU work.

How likely it is: this needs two extension frames (two windows with the panel, or the panel plus the options
page). That's uncommon but realistic, and it fails every time in that setup, in the two flows that cost money or
GPU. It's also a regression of working behaviour, and the handoff's own owner manual test ("run Ask council in a
second window's panel while Inspect is on") would catch it.

**Fix:** go back to **ignore-only** for foreign Ports: `if (port.name !== 'inspector') return;` with no
`disconnect()` and no listeners. Change the comment to say why (the docs passage above). Also tighten
`councilProtocol.ts:6-7`, which currently says "ignore (or disconnect)": disconnect is never safe for a
non-owner, so it should say "ignore, never disconnect". The original B-L4 problem (a crashed host looks alive
while Inspect has an end open) can't be fixed from a receiver. It belongs in `council.ts`, through the existing
`awaiting` timeout or a host heartbeat. Raise that as a follow-up ticket rather than solving it here.
**Test:** replace T1.38a with a test that a foreign Port gets **no** `disconnect()` call and no `onMessage`
listener, so the test pins the safe behaviour. Optionally, add a two-receiver fake where `disconnect()` on any
receiver fires the sender's `onDisconnect`, matching the docs, so the hazard is modelled once.

## HIGH

### B-H1: the overlay's `inspector` Port opens before Inspect's listener exists, so the card likely never updates in real Chrome
`views/Inspect/index.tsx:96-103` + `toggle()`; `overlay/index.ts:108`; `background.ts:10-13`

Order of events on Inspect click: `toggle()` → `send('overlay.set')` → SW `executeScript` → `tabs.sendMessage` →
the overlay's `setInspector(true)` calls `runtime.connect({name:'inspector'})` **synchronously** → the browser
fires `onConnect` in the extension frames that are listening *at that moment* → only then does the response go
back through the SW to the panel → `setInspect(true)` → React commits → the effect calls `attachInspector`. By
the time the panel listens, the connect has already been dispatched. Chrome doesn't replay `onConnect` to
listeners added later, so Inspect never sees the Port. Either the offscreen document holds the channel open (its
`llmHost` listener ignores the Port), or nobody listens and the overlay's `onDisconnect` nulls its port. Both
ways, the card stays at "Hover an element on the page".

This bug predates the PR: the old code attached in the same effect. But it is exactly the "Port opened before
Inspect mounts" case. The PR's tests hide it, because `turnOn()` waits for `onConnect.ls.size === 1` before it
fires the Port, and T1.34 e2e adds its *own* `onConnect` listener in the panel before it sends `overlay.set`
(`e2e/inspect.spec.ts:144-155`). So no test drives the real component through the real order. I couldn't run
Chrome from a read-only review, so **confirm by hand**: scan a page, click Inspect and hover. If the card updates,
note why and downgrade this to LOW.

**Fix (pick one):**
- (a) In the panel: attach before sending. Call `attachInspector(setHover)` inside `toggle('inspector', true)`
  before `send(...)`, keep `detach` in a ref, call it on failure, toggle off and unmount, and let the effect only
  reset `hover`.
- (b) In the overlay (outside this lane, so check with the orchestrator): connect lazily in `onFrame` when
  `inspecting && !port`. That way the first hover opens the Port after the panel is listening, and it also
  reconnects after any disconnect (see B-M1).

  Option (b) is more robust. Either needs a component test where the Port connects **during** the
  `overlay.set` call, for example by firing `onConnect` from the `sendMessage` mock before it resolves. That
  test would fail on both the old and the new code today.

## MEDIUM

### B-M1: after unmount (or a disconnect by another receiver), the overlay is stuck "inspecting" with no Port
`views/Inspect/index.tsx:79-85`; `overlay/index.ts:105-118`

Switching the panel away from the Inspect view unmounts `Toolbar`. `detach()` disconnects the inspector Port
(force-close, see above) but never sends `overlay.set {inspector:false}`. In the overlay, `onDisconnect` sets
`port = null`, but `inspecting` stays `true`: the hover box keeps following the mouse, and nothing reconnects.
Back on Inspect, `inspect` starts at `false`. Clicking Inspect sends `inspector:true`, which hits
`if (on === inspecting) return`, so there's still no Port and the card is dead until the user toggles off and on
twice. The same applies when B-C1's kind of force-close happens to the inspector Port: panel A turning Inspect off
disconnects the channel, so any other panel receiving it loses the stream. The old code left the Port open, so it
didn't nuke the stream, but it still never saw it after remount.
**Fix:** on unmount with Inspect on, send `overlay.set {tabId, inspector:false}` (best effort). Or apply
option (b) from B-H1, which reconnects whenever `inspecting && !port`. Don't `disconnect()` inspector Ports in
`detach()`; removing the listeners is enough, since the overlay owns its Port's lifetime.
**Test:** unmount with Inspect on → expect `sendMessage` called with `inspector:false`, or remount → toggle on →
a Port connected afterwards renders.

### B-M2: the tests pin the harmful behaviour and can't model multiple receivers
`test/inspect.test.tsx` T1.38a, T1.38 "toggling Inspect off… disconnects open ports", "unmounting… disconnect"

These tests assert `port.disconnect` was called, which is the behaviour B-C1 and B-M1 ask to remove. The fake
`onConnect` hub has one receiver and fires only after `turnOn()` has seen the listener, so none of the three
real-world orders gets exercised: foreign Port with several receivers, Port opened before mount, Port opened
during `overlay.set`. On "would they fail on the old code": every T1.38 test fails on the old code only because
`attachInspector` doesn't exist, so the import fails. Of the behaviours, the malformed-message test (a render
throw) and the post-after-toggle test would also fail meaningfully. **Fix:** rewrite as described in B-C1, B-H1
and B-M1.

## LOW

### B-L1: Inspect accepts an `inspector` Port from any tab in any window
`views/Inspect/index.tsx:58-74`. With Inspect on in windows A and B, both panels receive every overlay's Port, so
hovers from A's tab show in B's card. **Fix:** check `port.sender?.tab?.id` against the tab `toggle()` targeted
(keep it in a ref) and ignore others. Ignore, **don't disconnect**.

### B-L2: a fast double click sends `inspector:true` twice
`toggle('inspector', !inspect)` reads `inspect` from a stale closure while the first `send` is still pending, so
two quick clicks both turn it on (and the button ends up "on"). This predates the PR. **Fix:** a `pending` ref or
disabling the button while the request is in flight.

### B-L3: checked and fine
- **Validation:** `isHover` accepts the overlay's real payload: `cs.*` values are strings, the rect comes from
  `getBoundingClientRect` numbers, and `matchedTokens` is `{id,hex,prop}`. It checks exactly what the card reads
  (`rect.w/h`, `tag`, `styles` entries, `matchedTokens[].hex`). Nothing legitimate is dropped.
- **Listener leaks:** none. `release` removes both per-Port listeners, `detach` removes `onConnect` first and is
  idempotent.
- **StrictMode:** the effect runs only while `inspect` is true, and each run has its own `attachInspector`
  closure, so a double mount/unmount is clean.
- **Navigation:** the old overlay frame unloads, so `onDisconnect` fires and `release` runs. The new page needs a
  new `overlay.set`, as before.
