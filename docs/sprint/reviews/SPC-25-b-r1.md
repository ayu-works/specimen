# SPC-25 review, lens B (real-world failures), round 1

Reviewer: fresh lens-B session, 2026-10-15. Reviewed PR #27 at 7693002, plus the lens-A fold the executor has in
progress and hasn't committed yet (`createdTab` only for the home window; `!live` in the `catch`). Those two fixes
cover lens A's M1/L1, so they aren't repeated here.

**Verdict: 0 CRITICAL / 0 HIGH / 4 MEDIUM / 4 LOW.**

## Checked and fine
- **Normal window:** the popup path is unchanged apart from three reads before `windows.create` (`tabs.get`,
  `windows.get`, `tabs.query`). The arguments are the same (390x844, popup, unfocused), the same width check runs, and
  `windows.remove` runs on every exit. The existing e2e T5.03 runs in a real Chromium window and stays green.
- **Maximized or minimized** windows aren't `fullscreen`, so they take the popup path, as before.
- **Cleanup on error:** every throw after `windows.create` (guard, load, `scan.run` rejecting, too wide) goes through
  the `finally`. The emulation path always clears the override and detaches once attached. Attach failure sets no
  override.
- **Tests can fail:** 12 of the 13 T5.11 tests fail on main (the handoff says so, and the rig checks it: create args,
  `windows.remove` and `tabs.remove` targets, the debugger call order). The one that passes on main is the fail-open
  test, as intended.

## M1 (MEDIUM): an auto scan in full screen now emulates a phone in the user's own tab, with no click
**Scenario:** the user once granted `debugger`, either for dark mode (`runMediaCapture` uses the same permission) or
for a too-wide popup. Later they press Scan in full screen. "Also capture mobile" is on by default, so `runExtras` →
`captureMobile` → `emulateInTab` attaches to **their** tab with no further click. The live page reflows to 390px.
Chrome shows the "debugging this browser" bar. JS that reacts to resize runs on their real session: menus collapse,
carousels reset, modals close, video leaves full screen. Before this PR, automatic debugger use only ever touched the
throwaway popup tab. The user agreed to "dark mode" or "emulate in a popup", not to having their own tab driven on
every scan.
**Fix:** emulate in the user's tab only from a click. Pass `opts.emulate = withPermission` from `runMobileCapture`.
In full screen with `!opts.emulate`, throw `MobileFullscreenError` and show the note. Its button then does the
emulation, whether or not the permission is already held.
**Test:** full screen, debugger held, `runExtras(..., withMobile=true)` → no `debugger.attach`, `mobile ===
'fullscreen'`. Then the button click → attach on tab 5.

## M2 (MEDIUM): a desktop scan taken during the emulation records the phone layout as "desktop"
**Scenario:** full screen, debugger held. Scan A finishes and `status` becomes `done`, so the Scan button is enabled
again. The auto mobile emulation is now active on the same tab for about 1–2 s (settle plus `scan.run`). The user
clicks Scan again (or "Rescan", or the Diff view's scan). `scanTab` samples the tab while the 390x844 override is
still on, so a **desktop** scan with `viewport.w = 390` is saved to the Library. That's a misleading success, and it
can't happen on main, where emulation only ran in a separate popup. Two more effects in the same window:
- `succeed()` resets `extras` to `NO_EXTRAS`, so the new A5 re-entry guard (`extras.mobile === 'running'`) no longer
  sees the old capture. The new scan's auto-run starts a second emulation. Its attach fails ("Another debugger is
  already attached"), and the new card shows "skipped in full screen".
- A dark-mode "capture with permission" click during the emulation fails the same way.
**Fix:** keep a module-level lock for the user's tab in `captureFlow.ts`: `let emulating: number | null` (the tab id),
set around `sampleEmulatedPhone` when it runs on the user's tab. `scanTab` / `runTabScan` and `captureTheme('media')`
wait for it (or refuse with "finishing the mobile capture…"). The A5 guard belongs in that module too, not in
`extras`, which gets reset.
**Test:** start the full-screen emulation, then call `runTabScan` before it resolves → the desktop `scan.run` happens
only after `clearDeviceMetricsOverride` (assert the call order).

## M3 (MEDIUM): one error covers five causes, so the note and its button can be wrong and loop
`MobileFullscreenError` is thrown when (a) the window is full screen, (b) the scanned tab left the page, (c) the
debugger can't attach (DevTools open on that tab, which is common for this product's users), (d) the post-create
guard trips in a **non**-full-screen window (Chrome returned a non-popup, or put the page in an existing window), and
(e) the stray-tab case. All five show "skipped in full screen … Exit full screen and capture, or capture with
permission".
**Scenario (c):** the user is in full screen with DevTools open on the page and the permission held. They click
"Capture with permission": no prompt (already granted), attach fails, the state flips running → fullscreen, and the
same note comes back. Nothing tells them to close DevTools, and the button stays a dead end forever.
**Scenario (b):** the note doesn't say "switch back to the page you scanned". `runMediaCapture` does say it.
**Scenario (d):** a user who isn't in full screen is told to "exit full screen".
**Fix:** give the error a `reason: 'fullscreen' | 'navigated' | 'attach' | 'tabbed'`. Store it as `extras.note` (or
in a field next to `mobile`) and use matching wording: "Close DevTools on this tab, then try again"; "Switch back to
the page you scanned"; "Chrome opened the mobile window as a tab; nothing was captured". Show "Capture with
permission" only when the permission isn't already held; otherwise label it "Try again".
**Test:** one test per reason that asserts the note text. With `attachThrows` and the permission held, the button
reads "Try again".

## M4 (MEDIUM, plausible, needs a real-Chrome check): closing the panel mid-emulation can leave the user's tab stuck as a phone
**Scenario:** the side panel attached the debugger to the user's tab and set the 390x844 override. The user closes the
side panel, or it reloads (extension update, `pnpm dev` HMR), during those ~1–2 s. The `finally` (clear + detach) never
runs. `chrome.debugger` sessions belong to the extension, not the page, so as far as I know the attachment survives.
The user's own tab stays at phone width under the "debugging" bar until they click Cancel on it. On main the same
interruption only left a stray popup, which was ugly but didn't break their page.
**Fix:** on side panel start, `chrome.debugger.getTargets()` → for each `{attached: true, tabId}` that we attached,
send `Emulation.clearDeviceMetricsOverride` and `detach` (only if the permission is held). Do the same for the stray
popup: write the created window id to `chrome.storage.session` before the capture and remove it on the next start.
**Test:** a unit test of the startup sweep with a stubbed `getTargets`, plus one manual check (close the panel
mid-capture).

## L1 (LOW): the status line promises a window that never opens
In full screen with emulation, the card says "Capturing mobile… a small window opens for a moment." No window opens.
The user's own page shrinks instead. **Fix:** a second message for the emulation path, e.g. "Capturing mobile… this
page shows at phone width for a moment." That needs `captureMobile` to report which path it took, or a
`mobileVia: 'popup' | 'tab'` set before the work starts.

## L2 (LOW): a redirected page in the user's window still leaves the stray tab (the original symptom)
`createdTab` requires `url`/`pendingUrl` to match the scanned URL. A site that redirects (`/` → `/en/`, http → https,
a consent or login wall) gives the new tab a different URL by the time `tabs.query` runs. Nothing matches, nothing is
closed, and the user is left with the duplicate tab this ticket set out to remove. The home-window snapshot is exact,
so **one new id is enough evidence on its own**. **Fix:** in the home window, close the single new id whatever its
URL. Use the URL only to choose when there's more than one new id. **Test:** `created: 'panel-window'` with the new
tab's url `https://x.test/en/` → `tabs.remove(9)`.

## L3 (LOW): `chrome.debugger` missing while the permission is held → "Chrome kept the window too wide" in full screen
`sampleEmulatedPhone` throws `MobileTooWideError(0)` when `chrome.debugger` is undefined (e.g. the namespace isn't
bound in this context yet after a fresh optional grant). In full screen that shows the `wide` row about a window that
never existed. **Fix:** in `emulateInTab`, map a `MobileTooWideError` with `w === 0` to the full-screen reason
(`'attach'` under M3).

## L4 (LOW): the post-create guard tests are built on guessed return values; record the real ones in the owner check
The guard trips only if Chrome returns `type !== 'popup'`, `state: 'fullscreen'`, the home window's id, or more than
one tab. No one has seen what `windows.create` really returns on macOS full screen (or with Stage Manager, or in
Chromium forks that open popups as tabs, such as Arc). If Chrome returns a real `popup` with its own id that macOS
then shows full width, the guard never trips. The result is the old behaviour: `wide`, or an emulated popup, with the
window removed. That's acceptable, but the T5.11 race tests would still pass. A related case: on a second monitor
with "Displays have separate Spaces", the unpositioned popup can open on the other display's space.
**Fix:** add these to the owner's "How to check": (1) in full screen, toggle full screen right after pressing Scan,
then confirm no stray tab or window is left and see which note appears; (2) Stage Manager on; (3) a second display.
Pass `left/top` from the home window's bounds to `windows.create` so the popup opens on the scanned window's display.
Note in the handoff that the guard's shapes are unverified.
