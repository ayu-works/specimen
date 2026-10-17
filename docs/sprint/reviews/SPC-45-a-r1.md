# SPC-45 lens A r1 (PE pe-b2, 2026-10-17)

PR #48 @ 5c279bf, base `exec/spc-44` (e5d4df7): `scanFlow.ts` (`waitForTabLoad` `scanIfCommitted`, `rescanUrl`
cleanup), `test/rescanUrl.test.ts` (T5.14), three T5.12 cases, and TESTING.md. 30/30 green here.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW.**

## Checks
- **Only our tab, and the original error always wins:** `closeOwnTab(id)` uses the id from `tabs.create` and nothing
  else. It swallows a sync throw and a rejection (it's `await`ed inside an async `try`). Catch and rethrow passes the
  original error on. Tests: one remove per failure, "No tab with id" swallowed, cleanup that throws or rejects, other
  tabs' events ignored, no id → nothing closed.
- **Success keeps the tab:** that includes a `saveError` (SPC-20). `scanTab` returns it instead of throwing (tested).
- **`scanIfCommitted` is opt-in and bounded:** only `rescanUrl` sets it, and mobile capture keeps rejecting at the limit.
  The timeout still goes through `done()`, so listeners and timers are cleared and no read follows (T5.12 "then nothing is
  left", my note a). `committed()` needs no `pendingUrl` plus a visible, non-blank url, so a hidden url (an origin
  without access, the SPC-28 r2 case) still rejects (tested).
- **`last` only takes this tab's state:** `onUpdated` returns early on `tabId !== id` before it records anything, and
  another tab's committed event can't satisfy the check (tested, my note b).
- **The SPC-28 logic is unchanged:** the `ready` gate, `loaded()` and the abandoned-read resolve are as approved. The
  only move is that `last` is recorded before the `ready` check.
- **The tests can fail:** on the base branch, `rescanUrl` never calls `tabs.remove`, and a committed-but-loading page rejects.

## r1 fold check of lens B r1 (360890b, pe-b2): APPROVED, 0 C/H/M, 1 LOW
H1 (`scanWithin` 20 s cap + `scanTab` signal), M1 (`COMMITTED_MIN_MS` 5 s, reset when a `pendingUrl` reappears) and L1
(a read doesn't overwrite an event that arrived while it was in flight) are right. 37/37 green here (rescanUrl,
waitForTabLoad, scanSave).
- **L1 (optional):** the abort is checked once, after `scan.run` answers and before `extract`. If the 20 s cap fires
  while `saveScan` is already running, the save still commits but `rescanUrl` rejects and closes the tab. The scan
  is then in the Library while the panel says "took too long". The window is a few ms of IndexedDB. Fix: once `saveScan`
  has started, let it finish and let that result win (e.g. `scanWithin` races only up to the save point), or accept it
  and note it. No re-review needed.
