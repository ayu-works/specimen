# SPC-25 review, lens A, round 2

Reviewer: pe-99 (PE). PR #27, head `ceaaf2d`. 2026-10-15.
**Verdict: APPROVED. 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW.** One condition: CI `gate` must be green on `ceaaf2d`. It
was pending when I checked; the executor reports `pnpm gate` green locally.

- **M1: fixed.** `createdTab` now runs only when `win.id === homeId` and a snapshot exists. Any other existing window
  closes nothing. The new test (window 2 holds the user's tab on the URL and ours with no URL) asserts that neither
  `tabs.remove` nor `windows.remove` is called. The executor reports that it fails without the fix.
- **L1: fixed.** The `runMobileCapture` catch returns when `!live(scan.id)`. Tested with a stale failure after a newer
  scan.
- The diff since r1 is only these two hunks plus their tests. Nothing else changed.
