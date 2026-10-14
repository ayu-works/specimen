# SPC-25 review, lens A, round 1

Reviewer: pe-99 (PE). PR #27, head `7693002`. 2026-10-15.
**Verdict: 0 CRITICAL / 0 HIGH / 1 MEDIUM / 1 LOW.** Fold M1 (a two-line fix and one test); L1 is cheap. I re-review M1
only. CI `gate` was pending when I checked.

## Checked and fine (the 5 plan conditions)
1. **The created tab is identified exactly.**
   - The home window's tab ids are snapshotted before create.
   - `createdTab` returns a tab only when exactly one *new* id on the URL appears; otherwise nothing is closed.
   - `windows.remove` is never called on a window marked `intoExisting`.
   - Tests cover our tab not being at index 0, and two matching tabs → nothing closed.
2. **The preflight checks the scanned tab's window** (`tabs.get` → `windows.get`), else `getCurrent()`, else the old
   path. Tested.
3. **Emulating in the user's tab:**
   - `sameUrl` is re-checked right before attaching.
   - `AttachError` → `MobileFullscreenError`, with nothing attached.
   - The existing `finally` in `sampleEmulatedPhone` clears the override and detaches on every path after a successful
     attach. Tests cover a failing scan and a desktop width.
4. **T5.11 U is added**, and the normal-path tests keep T5.03.
5. **No double capture:** `runMobileCapture` returns early while `running`, and the buttons are hidden while running.

Other checks:
- No permission change. `debugger` stays optional and is only requested inside a click.
- The `AttachError` text never reaches the UI; it's mapped to `MobileFullscreenError`.
- A full-screen capture never stores a desktop width: the width check still runs after emulation.

## M1 (MEDIUM): `createdTab` can pick the user's tab when Chrome uses a *different* existing window
`captureFlow.ts:188-193`.
- `intoExisting` is also true when `win.id !== homeId` but `win.tabs.length > 1`, meaning Chrome put the page into
  some other existing window W2.
- `createdTab(win.id, before, url)` then filters W2's tabs against `before`, but `before` holds the **home** window's
  ids. So every tab in W2 counts as "new", and the URL filter is the only safeguard.

**Failure scenario:**
1. The user has the same site open in W2, say a second window on the same page.
2. Chrome drops our page into W2, and our tab's `url`/`pendingUrl` isn't set yet. The URL is often unset right after
   `create`, before navigation commits.
3. Exactly one tab matches: the user's own. We close it.

**Fix:** call `createdTab` only when `win.id === homeId` and `before` is set. For any other existing window, close
nothing (`strayTab` stays undefined) and throw `MobileFullscreenError`.

**Test:** `windows.create` returns a different window (id ≠ home) holding two tabs, the user's on the same URL and ours
with no URL yet → `tabs.remove` and `windows.remove` are never called.

## L1 (LOW): a stale capture's error state lands on the next scan's card
`extras.ts:141-153`. The success path checks `live(scan.id)`, but the `catch` branches (`fullscreen`, `wide`,
`failed`) patch `extras` unconditionally. A new scan resets `extras` to `NO_EXTRAS`.

**Scenario:**
1. Scan A's mobile capture is slow.
2. The user scans B, and B's auto-capture sets `running`.
3. A's capture throws `MobileFullscreenError` and sets B's card to `fullscreen`.
4. B's card now shows "skipped" with its buttons while B's capture is still running. A click can start a second
   concurrent capture, which gets past the new `running` guard. The success path has the same gap: when it isn't live,
   it returns and leaves nothing set, which is fine.

The race was already there before this PR, but this PR's guard relies on that state.

**Fix:** in the `catch`, `if (!live(scan.id)) return;` before patching. Test: start the capture for A, switch to B, then
reject A's capture → B stays `running`.
