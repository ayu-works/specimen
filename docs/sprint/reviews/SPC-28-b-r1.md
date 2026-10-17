# SPC-28 review, lens B (real-world failures), round 1

PR #39, branch `exec/spc-28` @ 521bcdc. Reviewer: fresh lens B. Read: setup.md, SPC-28 + 2 comments, handoff, `gh pr diff 39`,
`captureFlow.ts`, `tabEmulation.ts`, `rescanUrl` + Library caller, `wxt.config.ts` permissions, the mobileCapture test rig.

**Verdict: no CRITICAL or HIGH. 0 CRITICAL · 0 HIGH · 2 MEDIUM · 3 LOW.** The race is closed. Listeners and timers are
cleaned up on every path, and SPC-20 / #33 are left alone. Once the MEDIUMs are fixed or answered, this can be approved.

## What holds (checked, no finding)
- **complete before / during / after registration:** before → the first `tabs.get` resolves it. During → the event
  resolves it, or the next read does. After → the event resolves it. Lost (dispatched before the IPC registration lands) →
  the chained re-read catches it within ≤ 500 ms. The poll backstops any cause where the tab's status ends up `complete`,
  so it doesn't depend on the exact SPC-25 root cause.
- **No double settle, no leak:** every exit (event, read, removed, timeout, `No tab with id`) goes through the idempotent
  `done()`. It clears both timers and removes both listeners. A read still in flight at settle is ignored: `done()` is a
  no-op, and the `!settled` guard stops a new `recheck` from being scheduled. The timeout test asserts no reads after settle.
- **Tab closed or replaced while waiting:** `onRemoved` → fast reject. A prerender/instant `onReplaced` gives the old id
  `No tab with id` on the next read → "The tab was closed" within 500 ms. Before, it hung 30 s. (The wording is
  slightly off for a replace, but that's rare for an extension-created tab. It's acceptable.)
- **`tabs.get` rejecting:** `No tab with id` → clear reject. Anything else is retried until the bounded timeout. It can't
  turn into a misleading success, because only `tabLoaded(t)` or a matching event resolves.
- **Timeout:** still 30 s and bounded. The text is clear, `friendlyScanError` maps it, and mobile shows "Mobile capture
  skipped: The page took too long to load". The popup is still closed in `finally`.
- **Workaround removal:** `remember()` swallows its own errors, so `await rememberMobileWindow` can't throw before the
  `try` and leak the window. The record is now strictly set → clear. A slow storage write only delays the first read, and
  the re-read recovers anything missed in that gap. Full-screen paths never reach `windows.create`/`waitForTabLoad`, so
  they're unaffected.
- **SPC-20 / #33:** `scanTab`'s `saveError`, `libraryErrorText` and the existing `friendlyScanError` branches are unchanged.
  The diff doesn't touch css.fetch.
- **Tests:** "complete event lost (SPC-25)" drives the lost-event path for real (the event never fires, read 1 = loading,
  read 2 = complete). It would hang to the timeout on main, and the handoff confirms 6/11 fail there.

## MEDIUM

### M1. In production the `about:blank` guard depends on `pendingUrl` alone: `url` is hidden on about:blank
The extension has no `tabs` permission (wxt.config.ts:23-29), so `Tab.url`/`pendingUrl` are only exposed when host
permissions match. `<all_urls>` covers http/https/file/ftp/ws, not `about:`. So for the initial blank document, real Chrome
gives `url: undefined`, never `'about:blank'`, and `t.url !== 'about:blank'` is effectively dead code. Per the PE's
deviation, `url: undefined` counts as loaded. The only thing that stops an early resolve is `pendingUrl` (visible,
because it's the https target).
**Scenario:** Chrome reports `status: 'complete'` on the initial blank document of a `windows.create`/`tabs.create` tab
in a moment when `pendingUrl` is unset (for example, between the blank commit and the real navigation's
`pendingUrl` assignment). `tabLoaded` → true → `rescanUrl` injects into about:blank → "Unsupported page: about:blank" →
"Specimen can only scan websites", or mobile capture samples an empty page. The T5.12 about:blank test passes only
because its stub exposes `url: 'about:blank'`, which the real API doesn't do for this extension.
**Fix:** callers know the target url, so pass it: `waitForTabLoad(id, { expectUrl })`. Then treat as loaded only when
`complete && !pendingUrl && (url === undefined ? <seen a non-blank url/pendingUrl before> : url !== 'about:blank')`.
The simplest version: remember once any read or event has shown a `pendingUrl` or a non-blank `url`, and don't accept a
`url: undefined` complete before that. At minimum, add a test with the realistic shape `{status:'complete', url: undefined,
pendingUrl: PAGE}` → pending, then `{status:'complete', url: undefined}` → resolved. Note in the handoff that the url check
is a no-op without `tabs`.

### M2. No CI-level evidence that removing the workaround is safe; the e2e repro didn't fail on main either
The handoff records that T5.03 with a 1 s delay passed on both the new **and** the old `waitForTabLoad`. So the only
proof is the unit test, which proves the mechanism but not that the real SPC-25 hang was this mechanism. If the real cause
were different (for example, the popup's tab reporting `complete` while `tabs.get` keeps answering an id whose status
doesn't settle, or the read itself stalling), removing `void` would bring the T5.03 CI flake back.
**Scenario:** CI's slower runner reproduces the SPC-25 timing. The awaited `storage.session.set` widens the gap, the
event is lost, and the re-read should catch it. If it doesn't, T5.03 is red on main after merge.
**Fix:** before merge, run `pnpm build && pnpm e2e -g "T5.03" --repeat-each=20` (ideally also with the temporary 1 s
delay, and in CI or under CPU throttling) and record the pass count in the handoff. Optionally, log the read count at
resolve in the e2e build, to show the re-read is what resolved it at least once.

## LOW

### L1. Some 'never complete' cases now wait 30 s and then say "took too long"
`tabLoaded` requires `!pendingUrl` and a non-blank url. A rescan URL that answers 204, or that turns into a download
in a tab Chrome doesn't close, leaves the tab on blank. Before, it resolved at once and gave the accurate "Specimen can
only scan websites". Now it waits 30 s and says "The page took too long to load. Check the address or your connection",
which is misleading. Rescan URLs come from previously scanned pages, so this is rare.
**Fix:** after N reads (for example 2 s) of `complete` with no `pendingUrl` and a blank/hidden url following a pending
navigation, reject at once with "The page didn't load" (it maps to the existing error-page sentence). Or accept it as is
and note it in the handoff.

### L2. Heavy real pages can still miss `complete` within 30 s (preexisting, now with a clearer label)
`complete` waits for every subresource and iframe. Ad-heavy or news pages with a slow third party can stay `loading`
well past 30 s while being fully usable. Rescan then fails with "took too long" for a page the user can see.
**Fix (optional, could be a follow-up ticket):** on timeout, if the last read shows the expected url committed
(`!pendingUrl`, url set), resolve anyway and let the 800 ms settle and the scan go ahead. Only reject when the navigation
never committed. This keeps the wait bounded and avoids a false failure.

### L3. The "during" test passes on main's code too
T5.12 "complete while the listener attaches" fires the event in a microtask after `addListener`. Main's listener also
resolves on that, so the test doesn't tell old from new (only the `get` call count is new). That's fine as a regression
guard, but the T5.12 row says "during" is covered. Real "during" loss is the lost-event test.
**Fix:** rename it to "event and read both race: settles once, no further reads", or have the event arrive with
`tab.pendingUrl` set, then a read showing complete, so it exercises the new filter.
