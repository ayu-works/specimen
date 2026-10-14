# SPC-25 review, lens A, round 4 (fix check from the diff, b624dd5..87914c8)

Reviewer: pe-99 (PE). PR #27, head `87914c8`. 2026-10-15.
**Verdict: APPROVED. 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW.** One condition: CI `gate` must be green on `87914c8`.

- **r3 M1: fixed.** `intoExisting` is computed first, and `ownWindow = !intoExisting && win.id !== homeId` controls both
  the `mobile.window` record and its clear. A user's other window is never recorded, so recovery can't close it.
  Tested, including a later `recoverMobileCapture()` that never calls `windows.remove`.
- **r3 L1: fixed.** `createdTab` closes exactly one new tab on the URL, or a lone new tab that is still blank. A new
  tab page or a redirected page is left open. Tested: newtab and redirect → nothing closed, `about:blank` → closed.
- The diff changes only these two spots in `captureFlow.ts`, plus tests and docs.
