# SPC-45 lens B review, round 1

PR #48 (`exec/spc-45` on `exec/spc-44`). Reviewer: fresh lens B. Read: setup.md, the handoff, `gh pr diff 48`,
`scanFlow.ts`, `backgroundScan.ts`, `messaging.ts`, `Library/index.tsx`.

**Count: 0 CRITICAL · 1 HIGH · 2 MEDIUM · 3 LOW**

What holds up: the close is the id `create` returned and nothing else; `closeOwnTab` swallows sync throws and
rejections, and the original error is rethrown. `done()` still settles once, so a timeout and a late `complete` can't
resolve twice, and the catch block runs once per re-scan, so there's no double close. The timeout path goes through
`done()` (listeners, timer and read all cleared, tested). SPC-28's settle-once/abandoned-read logic is unchanged
apart from `last` being recorded, and `scanTab`/`saveError` (SPC-20) are untouched. Tab ids aren't reused within a
browser session, and a tab dragged to another window keeps its id, so `remove(id)` still targets our tab. The tests
drive real failure paths through `rescanUrl` with a stubbed `chrome.tabs`, and the "only our id" and timeout-close
tests fail on the old code.

---

## HIGH

### H1. Scan-what's-there can hang the re-scan forever on a page whose HTML hasn't finished (the PR's own manual test 3)
`scanIfCommitted` resolves when the url has committed, but the scan then runs `chrome.scripting.executeScript` with no
`injectImmediately` (`backgroundScan.ts` `sample`). Without it Chrome injects at **document_idle**, which needs the
document to reach DOMContentLoaded. A committed page whose HTML is still streaming or stalled (a slow server, or
manual test 3's `res.write` with no `end()`) never gets there, so the injection never resolves. `send('scan.run')` has
no timeout (`messaging.ts` only throws on an empty response), so `scanTab` never settles.
- **Failure scenario:** re-scan a page whose server sends headers and part of the body, then stalls. At 30 s
  `committed(last)` is true → `waitForTabLoad` resolves → 800 ms → `scan.run` → `executeScript` waits for
  document_idle forever. The panel shows "Re-scanning host…" indefinitely, no error is ever shown, and the
  catch/close never runs, so the tab stays open (until the user closes it, which finally rejects the injection).
  **Before this PR the same page failed after 30 s with a clear "took too long" message**, so this case gets worse,
  and it's the very case manual test 3 tells the owner to expect "scanned as it is".
- The slow-ad case the ticket targets (DOMContentLoaded fired, `load` held up by a subresource) is fine: document_idle
  fires after DCL. Only "committed but DCL not reached" hangs. Unit tests can't see this because `send` is mocked.
- **Fix (pick one):**
  (a) In `rescanUrl`, race `scanTab(id)` against a bound (e.g. 15 s) that rejects with
  `new Error('The page took too long to load')`. The catch then closes the tab, which also kills the hung injection.
  Simple and covers any future scan hang. Add a T5.14 case: `send` never resolves → rejects "took too long" after the
  bound, and `remove` is called once.
  (b) Make "committed" mean "DOM ready": at the timeout, before resolving, run a tiny `injectImmediately: true`
  script that reads `document.readyState` and resolve only on `interactive`/`complete`. This is more precise but needs
  a new background message or `scripting` call from the panel.
  Either way, fix manual test 3's expected result, or switch it to a page that reaches DCL and holds `load` (e.g. an
  `<img>` pointing at a stalled endpoint), which is the case the feature is actually for.
  **Please verify H1 with manual test 3 as written before the fix.** My reading of document_idle comes from
  Chromium's run-location semantics, not from a run here.

## MEDIUM

### M1. "Committed for most of 30 s" isn't what the code checks: a page that committed at 29.6 s is scanned 0.8 s later
`committed(last)` looks only at the last state at the timeout, with no record of when the commit happened. A slow
redirect chain or a server with a ~29 s TTFB commits just before the limit, then gets the 800 ms settle and the scan.
The result is a near-empty page (no late CSS, maybe only the `<head>` parsed), reported as a normal success, added to
the Library and opened in Inspect.
- **Failure scenario:** a slow-backend site that has a good card in the Library. Re-scan → it commits at 29.5 s → it's
  scanned at ~30.3 s → Inspect shows a palette of two greys and the system font, with nothing saying it's partial. The
  PR body's residual ("only applies to a page that has been committed for most of 30 s") understates this.
- **Fix:** record `committedAt` (the time `committed(t)` first became true for the current navigation, reset when a
  `pendingUrl` shows up) and resolve at the timeout only if it has been committed for ≥ N s (e.g. 5 s); otherwise
  reject as today. Or keep the code and correct the residual's wording, plus add a scan warning
  (`raw.warnings.push('page was still loading')`) so the result isn't silently presented as complete. A T5.12 case:
  committed state first seen 200 ms before the limit → rejects.

### M2. After the tab is closed, two error texts tell the user to "Reload it", which is no longer possible
Re-scan errors go through `friendlyScanError`. For `showing error page` the panel says "This page didn't load. Reload it
and scan again."; for `sampler returned no result`, "Couldn't read this page. Reload it and scan again." Both now show
**after** we've closed the tab, so there is nothing to reload. ("Click Scan again" for a stopped worker has the same
problem: the Library has Re-scan, not Scan.)
- **Failure scenario:** re-scan a host that's down → Chrome's error page → scan error → tab closed → "Reload it and scan
  again". The user looks for the tab, finds none, and doesn't know Re-scan is what to press.
- **Fix:** in `Library/index.tsx` `rescan`, rewrite those texts for the re-scan context (e.g. replace "Reload it and
  scan again" / "Click Scan again" with "Press Re-scan to try again"), or have `friendlyScanError` take a
  `{ rescan: true }` flag. It's a copy-only change in the caller; `friendlyScanError`'s other callers stay as they are.

## LOW

### L1. A slow `tabs.get` answer can overwrite a newer event in `last`
`last` is set by whichever arrives last, a read answer or an `onUpdated` tab. If a read is in flight when a client-side
redirect starts (an event with `pendingUrl`), and the read's answer (the committed old page) is processed after it,
`last` says "committed" while a navigation is pending. If that's the state at the timeout, we scan mid-navigation;
the sampler then usually fails, so the tab is closed with a confusing error, or it scans the page being left.
- **Fix:** optional. Prefer the event over a read answer that started before it (remember a sequence number when the
  read is issued and ignore an older answer for `last`). It's rare enough to just note it.

### L2. Library re-scan drops `saveError` (pre-existing, outside this diff, but the brief asked)
`rescan` calls `openScan(out.scan, 'tab', out.screenshot)` without `out.saveError`, while `runScan.ts` passes it to
`succeed(...)`. A re-scan whose Library save failed (quota, private window) opens Inspect looking saved, and SPC-20's
"the panel says so" doesn't hold on this path. This PR keeps the tab open in that case, which is correct.
- **Fix:** a follow-up ticket: pass `out.saveError` through (`openScan`'s signature, or whatever runScan's `succeed`
  uses). Not a blocker for SPC-45.

### L3. Two re-scans at once: tabs are handled correctly, the panel state isn't (pre-existing)
The Re-scan buttons stay enabled while `busy`. Two re-scans each close only their own tab (verified, fine). But the
first to finish runs `setBusy(null)` while the second is still running, the second's `setError(null)` can wipe the
first's error, and whichever finishes last wins Inspect. This isn't new in this PR.
- **Fix:** follow-up. Disable Re-scan while `busy`, or keep a counter or token so only the latest re-scan updates
  the panel.

---

Accepted residuals: re-checked. The navigate-our-tab, panel-closed and `onReplaced` residuals are as stated (on
`onReplaced` the panel shows "The tab was closed before the scan finished." while a tab is visibly open, which is
mildly misleading but rare). The partial-CSS residual is understated; see M1.
