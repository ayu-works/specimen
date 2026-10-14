# SPC-25 review, lens A, round 3 (the lens-B fold, ceaaf2d..b624dd5)

Reviewer: pe-99 (PE). PR #27, head `b624dd5`. 2026-10-15.
**Verdict: 0 CRITICAL / 0 HIGH / 1 MEDIUM / 1 LOW.** Both fixes are small. I re-check them from the diff only. CI
`gate` was pending when I checked.

## Fine
- **B-M1:** only a click (`emulate: withPermission`) emulates in the user's tab. The automatic capture in full screen
  always skips. Tested.
- **B-M2:** `withTabEmulation` runs emulations one at a time, and `scanTab` and `captureTheme` await
  `tabEmulationIdle()`. The queue swallows errors, so one failed emulation doesn't block the next. Tested for ordering
  (the desktop `scan.run` comes after the clear).
- **B-M3:** `MobileSkippedError(reason)` uses fixed `SKIP_NOTES`. No error text reaches the UI.
- **B-M4 recovery:**
  - It runs on panel start, and only when this is the only side panel.
  - It clears the override and detaches, both best effort.
  - The records are in `storage.session`, which is cleared on browser restart, so stale window ids from an earlier
    browser session can't be acted on.
  - The `void` record followed by an awaited clear is safe: `chrome.storage` applies one context's writes in order.
- **B-L3:** a missing `chrome.debugger` gives the reason `attach`. **B-L1:** running text only.

## M1 (MEDIUM): recovery can close one of the user's *other* windows
`captureFlow.ts:212`. `rememberMobileWindow(win.id)` runs whenever `win.id !== homeId`, **before** `intoExisting` is
computed. When Chrome puts the page into a different existing window W2 (`win.tabs.length > 1`), W2's id is recorded.
The `finally` clears it, but only if the panel survives until then.

**Scenario:** the user closes or reloads the side panel between `windows.create` and the `finally`. The panel's JS
stops, so the clear never runs. On the next panel start, `recoverMobileCapture()` calls `chrome.windows.remove(W2)`
and closes the user's whole other window, with all its tabs.

The window of time is short, but the result is exactly what this ticket exists to prevent.

**Fix:** compute `intoExisting` first, and record the window only when it is ours: `!intoExisting && win.id !== homeId`.
Apply the same condition to the clear in `finally`.

**Test:** `windows.create` returns W2 (id ≠ home, 2 tabs) → `storage.session` never holds `mobile.window`. Then
`recoverMobileCapture()` with only `mobile.tab` set never calls `windows.remove`.

## L1 (LOW): `createdTab` now closes any single new tab in the home window, whatever its URL
The B-L2 change accepts a lone new id even when its URL differs. Between the snapshot (before `create`) and the
`tabsIn` query after it, a tab the user opens with Cmd+T (`chrome://newtab/`), or one another extension opens, is
also "the single new id". We would close it. The plan required a URL match for exactly this reason.

**Fix:** accept a lone new id only if its `url` or `pendingUrl` matches the requested URL (`sameUrl`), or is empty or
`about:blank` (still loading). If our page redirected before we looked, leave the tab: a stray tab is the safe
failure.

**Test:** a single new tab on `chrome://newtab/` → nothing closed.
