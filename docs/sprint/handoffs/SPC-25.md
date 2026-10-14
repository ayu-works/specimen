# SPC-25 handoff: Scan in macOS full screen opens the site in a new tab

Executor session: `spc-25-79` · Branch `exec/spc-25` (rebased on origin/main 986317e) · Lane B · PE `pe-99` · Orchestrator `specimen-53`

## Plan (APPROVED by pe-99 2026-10-15 with changes A1–A5, folded below)

### The bug
`captureMobile` (`apps/extension/src/lib/captureFlow.ts:67`) always calls `chrome.windows.create({type:'popup', 390x844, focused:false})`.
In macOS full screen Chrome can't show a separate small popup, so the user sees the site open again as a tab/space
at full width; the capture then reads a desktop width (`MobileTooWideError`) or worse. A second, latent hazard: the
`finally` calls `chrome.windows.remove(win.id)`. If Chrome ever hands back a tab placed in the user's *existing*
window, `win.id` is the user's window, and we would close it.

### Approach
1. **Preflight** in `captureMobile`: read the panel's window (`chrome.windows.getCurrent()`; the side panel lives in
   the window the user scanned from). If `state === 'fullscreen'`:
   - debugger permission held **and** the caller passed the scanned `tabId` → emulate in that same tab with the
     existing `sampleEmulatedPhone(tabId)` (390x844 override, cleared + detached in its `finally`); width check as today.
   - otherwise → throw new `MobileFullscreenError`. **No window or tab is created.**
   If `getCurrent()` throws, behave as today (fail-open to the normal path; the post-create guard below still holds).
2. **Post-create guard** (race: user enters full screen between check and create, or Chrome ignores `type`): after
   `windows.create`, if the returned window is not a `popup`, is `fullscreen`, or has the panel window's id, treat it
   as full screen: clean up and throw `MobileFullscreenError`.
3. **Cleanup that never closes the user's window:** `finally` removes the created window only when its id differs from
   the panel's window id; otherwise it removes just the created tab (`chrome.tabs.remove(tabId)`). Both `.catch(()=>{})`
   as today.
4. **Signature:** `captureMobile(url, desktop, opts?: { tabId?: number })`. `runMobileCapture` (extras.ts) passes
   `extras.tabId` only when `tabStillOnPage(tabId, scan.url)` (so we never emulate on a tab that navigated away).
5. **UI / state:** `Extras.mobile` gains `'fullscreen'` (one union member in `sidepanel/store.ts`). On
   `MobileFullscreenError`, `runMobileCapture` sets `mobile: 'fullscreen'`. `Scan.tsx` shows Row "Mobile: skipped in
   full screen" plus the note "Mobile capture is skipped in full screen. Exit full screen and press capture, or capture
   with permission (emulates a phone in this tab)." with the same "Capture with permission" button as the `wide` case
   and a plain "capture" retry link (works after exiting full screen). No variant is stored.

### Files
- `apps/extension/src/lib/captureFlow.ts` (Owns) — preflight, guard, cleanup, new error.
- `apps/extension/src/entrypoints/sidepanel/views/Scan.tsx` (Owns) — fullscreen row/note/button.
- `apps/extension/src/entrypoints/sidepanel/extras.ts` — pass tabId, map the new error (small; side-panel lane B; not
  in the plan's Owns list → flagging it here).
- `apps/extension/src/entrypoints/sidepanel/store.ts` — add `'fullscreen'` to the union only (SPC-26 owns it next in
  the same lane, so no overlap).
- `apps/extension/test/mobileCapture.test.tsx` — tests (extend the local `rig` with `windows.get/getCurrent`,
  `tabs.remove`; the shared `test/helpers/chrome.ts` is SPC-21's and stays untouched).
- `docs/TESTING.md` — no new ID; tests are `T5.03 …` (ticket says T5.03-related). PE: say if you want a new row.

### Failure modes
- **Partial failure / cleanup:** every created window/tab is removed on every exit path (success, too wide, scan.run
  rejects, tab load fails, guard trips). Emulation path: override cleared + detached even when scan.run throws (existing).
- **Closing the wrong thing:** never `windows.remove` the panel's own window; tab-only removal in that case.
- **Race (fullscreen toggled mid-capture):** post-create guard catches it; worst case before the fix's preflight
  ran is the same cleanup.
- **Stale tab:** emulation only on `extras.tabId` still on `scan.url`; else fullscreen error + note.
- **Misleading success:** a fullscreen capture never stores a desktop-width "mobile" (width check still applies after
  emulation).
- **Idempotency:** retrying ("capture" link / permission button) re-runs the same preflight; no state left behind.
- **Query failure:** `getCurrent` throws → old behaviour; guard and safe cleanup still apply.
- Not handled: real macOS behaviour can't run in CI; verified with stubs only. Owner checks manually per "How to check".

### Tests (vitest, `apps/extension/test/mobileCapture.test.tsx`, stubbed `chrome.windows`)
Marked **[fails on main]** where today's code fails them.
1. T5.03 fullscreen window, no debugger → `MobileFullscreenError`, `windows.create` not called. **[fails on main]**
2. T5.03 fullscreen + debugger + tabId → no `windows.create`; debugger attach/override/clear/detach on the scanned
   tab; returns `viewportWidth` 390. **[fails on main]**
3. T5.03 fullscreen + debugger but no tabId → `MobileFullscreenError`, nothing created/attached. **[fails on main]**
4. T5.03 normal window → unchanged: popup 390x844 created and removed (existing tests, rig now reports `normal`).
5. T5.03 race: created window comes back `fullscreen` → `MobileFullscreenError`, that window removed. **[fails on main]**
6. T5.03 Chrome returns the panel's own window (tab placed in it) → only `tabs.remove(42)`, never
   `windows.remove(<panel window>)`. **[fails on main]**
7. T5.03 `getCurrent` throws → normal popup path.
8. T5.03 `scan.run` rejects after create → window still removed (audit M10, the cleanup part).
9. T5.03 `runMobileCapture` on `MobileFullscreenError` → `extras.mobile === 'fullscreen'`, no `variants.mobile`. **[fails on main]**
10. T5.03 Scan card in `fullscreen` → row + note text + "Capture with permission" requests `debugger`. **[fails on main]**

Check: `pnpm gate` green (the existing e2e T5.03 runs in a normal Chromium window and must stay green).

## PE changes folded (A1–A5)
- **A1 exact created tab:** before `windows.create`, snapshot the tab ids of the target window (`tabs.query({windowId})`).
  If Chrome returns the target window, the created tab is the single new id whose url/pendingUrl matches `url`; never
  `win.tabs[0]`. Not exactly one → remove nothing, throw `MobileFullscreenError`. Test 6: several tabs, ours not at
  index 0, only ours removed.
- **A2 preflight window:** with a tabId, `tabs.get(tabId).windowId` → `windows.get(windowId)`; without one,
  `windows.getCurrent()`. Both tested.
- **A3 emulating in the user's tab:** re-check `tabStillOnPage` right before attach (captureMobile takes a
  `stillOnPage` check from the caller, or does `tabs.get` + url compare itself). Attach failure (DevTools open, another
  debugger) → `MobileFullscreenError`, nothing attached, no override set; tested. Override cleared + detached on every
  path after attach; tests 2/3 assert clear+detach on throw too.
- **A4 TESTING.md:** new row `T5.11 | U |` (full-screen mobile capture). Tests 1–3, 5–7, 9–10 named T5.11; normal-path
  tests keep T5.03. Run `pnpm check-ids --all`.
- **A5 no double capture:** the Scan card hides both "capture" and "Capture with permission" while
  `extras.mobile === 'running'` (render conditions), and `runMobileCapture` returns early if `extras.mobile` is already
  `'running'` (covers a double click before re-render and the auto-run racing a click). Tested.

## Done
- Read brief/setup/plan, SPC-25 (no comments), audit M10. `pnpm i`. Rebased on origin/main (986317e).
- Plan approved by pe-99 with A1–A5 (folded above).
- Tests first: 13 new T5.11 tests in `apps/extension/test/mobileCapture.test.tsx`; 12 failed on main (the
  "state cannot be read" one is the fail-open path and passes on main by design). Normal-path T5.03 tests kept and
  two added (popup args + cleanup; cleanup when scan.run rejects).
- Built: `captureFlow.ts` (`MobileFullscreenError`, `scanWindow` preflight, `emulateInTab` with on-page recheck and
  attach failure → fullscreen, post-create guard, exact created-tab cleanup), `extras.ts` (tabId passed, re-entry
  guard, `'fullscreen'` state; a refused permission returns to the state it came from), `store.ts` (union member),
  `Scan.tsx` (row, note with a "capture" retry link, "Capture with permission"; hidden while running).
  `docs/TESTING.md` T5.11 row.
- `pnpm gate` green (extension 99 tests, e2e 51, check-ids 106 IDs).

- Lens A r1 (pe-99, `docs/sprint/reviews/SPC-25-a-r1.md`): M1 fixed (`createdTab` only for the home window; any
  other existing window → close nothing), L1 fixed (`runMobileCapture` catch returns when the scan isn't live). Two
  new T5.11 tests; both fail without the fix. PE re-reviews M1 only.

- Lens A r2: APPROVED on ceaaf2d (condition: CI green).
- Lens B r1 (`docs/sprint/reviews/SPC-25-b-r1.md`), all folded:
  - M1: emulation in the user's tab only from a click (`captureMobile` `emulate`, set by `runMobileCapture(…, true)`);
    the automatic capture in full screen always skips.
  - M2: new `lib/tabEmulation.ts`: emulations in the user's tab run one at a time; `scanTab` and `captureTheme` wait
    for them, so a desktop scan never reads the phone override.
  - M3: `MobileFullscreenError` → `MobileSkippedError(reason)` with `fullscreen | navigated | attach | tabbed`;
    `extras.mobile` `'skipped'` + `extras.mobileSkip`; `SKIP_NOTES` per reason; button "Capture in this tab"
    (full screen) or "Try again".
  - M4: the emulated tab and the popup window id are recorded in `storage.session`; `recoverMobileCapture()` on
    side-panel start (`main.tsx`) clears the override, detaches and closes the popup; it skips when another side panel
    is open. Unit-tested only. **Owner check:** close the panel mid-capture.
  - L1: the running line says "this page shows at phone width" on the emulation path.
  - L2: superseded by lens A r3 L1 (below): a redirected stray tab is left open (the safe failure).
  - L3: no `chrome.debugger` → `attach` reason, never "too wide".
  - L4: owner checks added below. Not done: passing `left/top` for a second display. That's a popup-placement
    change outside this bug. **The post-create guard's return shapes are unverified on real macOS.**

- Found while folding: the popup-window record must not be awaited between `windows.create` and `waitForTabLoad`.
  With the await, e2e T5.03 hung. Logging showed `tabs.get` said `loading`, and the `status: 'complete'`
  `onUpdated` never arrived after the listener attached. That's a race already in `waitForTabLoad` (scanFlow.ts; also
  used by `rescanUrl`), not new code. Now fire-and-forget (`void`). **Follow-up suggested:** make `waitForTabLoad`
  also poll `tabs.get` (separate ticket; scanFlow is SPC-19/20's).

- Lens A r3 (`docs/sprint/reviews/SPC-25-a-r3.md`), both fixed:
  - M1: the popup window is recorded for recovery only when it is ours (`!intoExisting && win.id !== homeId`), and
    cleared under the same condition, so recovery can never close another of the user's windows.
  - L1: a lone new tab in the home window is closed only if it's on the url or still blank (empty/`about:blank`); a
    new tab page or a redirected page is left alone.
  - Tests: 3 new T5.11 tests; 2 fail on b624dd5 (the about:blank one passes there too).

- Lens A r4: APPROVED on 87914c8, 0 findings (condition: CI gate green).

## Owner check (macOS)
1. Full screen, "Also capture mobile" on, Scan → no new tab or window; the card says "skipped in full screen".
   "Capture in this tab" → the page shows at phone width briefly, then Mobile: captured.
2. Normal window → the popup opens and closes as before.
3. Press Scan, then toggle full screen right away → no stray tab or window; note which note shows.
4. Close the side panel during "Capture in this tab", reopen → the tab is back at full width, no debugging bar.
5. Optional: Stage Manager on; a second display.

## Next
- CI gate green on the PR head → orchestrator moves on (owner decides the merge after the macOS checks above).
- Follow-up (orchestrator to file): the `waitForTabLoad` race (see above).

## How to resume
Worktree `specimen-herdr/worktrees/spc-25`, branch `exec/spc-25`. Read this file, then `git log origin/main..` and the
PR. Reviews arrive in `docs/sprint/reviews/SPC-25-*.md`.
