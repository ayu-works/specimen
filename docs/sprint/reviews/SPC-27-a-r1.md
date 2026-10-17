# SPC-27 lens A r1 (PE pe-b2, 2026-10-17)

PR #50 @ 2395761, base main: `views/Inspect/index.tsx`, `test/inspect.test.tsx` (T1.38), and TESTING.md.

**Verdict: CHANGES REQUIRED. 1 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW.** The CRITICAL comes from my own plan ruling
("disconnect foreign Ports"), which was wrong. The executor built what I approved.

## CRITICAL

### C1. In real Chrome, one receiver's `disconnect()` closes the channel for every receiver
**Probe (real Chromium, the e2e build, three extension pages):** a "host" page listens for Port `probe`, an "inspect"
page's `onConnect` either ignores it or calls `port.disconnect()`, and a third page `runtime.connect({name:'probe'})`s,
posts "first", waits 1 s, then posts "second".
```
inspect ignores:     senderOnDisconnect 0, post OK,                                            host got ["first","second"]
inspect disconnects: senderOnDisconnect 1, "Attempting to use a disconnected port object",     host got ["first"]
```
So a second receiver's `disconnect()` tears down the sender's Port **and the host's end**. (The Chrome docs are
ambiguous here, and this is the measured behaviour.) With #50, any side panel that has Inspect on would break:
- every `council` Port a panel in another window opens (the run looks interrupted, and `start` may never reach the host);
- every `llm` Port from the options page or another panel (Gemma load/chat dies at once);
- the overlay's `inspector` Port for **other** panels, because detach (toggle off/unmount) disconnects inspector
  ports that a second window's Inspect also receives.
The unit fake can't show this: each fake Port is independent.
**Fix:**
1. A foreign Port: **ignore only.** Return without reading it, adding listeners or disconnecting it. This is what
   `llmHost.ts:345` and `councilHost.ts:250` already do.
2. `detach()` and `onDisconnect`: remove *this panel's* listeners from inspector ports, never `port.disconnect()`.
   Keep the `live` flag and the shape guard (both are good).
3. Fix the contract comment in `lib/councilProtocol.ts:6-7`: "must ignore ports named `council` and never
   disconnect them: in Chrome one receiver's disconnect closes the channel for the host too." (I own that contract,
   and this edit is OK in #50.)
4. Tests: foreign Port → `disconnect` never called and no listener added. Detach → listeners removed, `disconnect`
   never called. Add a comment that cites this probe. If you can, add an e2e (T1.38) like the probe above, with the
   side panel's real Inspect on and a second page's Port to a host page, asserting that the host still receives after
   Inspect sees the Port. That pins the real behaviour, which no fake can.

The rest of the PR (the shape guard typed against `InspectorHover`, the `live` flag, cleanup that removes the onConnect
listener first and is idempotent) checks out and stays.
