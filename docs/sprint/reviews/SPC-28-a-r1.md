# SPC-28 lens A review, round 1

Reviewer: PE pe-4d (lens A) · PR #39 · head 521bcdc · 2026-10-17
Scope: `scanFlow.ts` (`waitForTabLoad`, `friendlyScanError`), `captureFlow.ts`, `test/waitForTabLoad.test.ts`, TESTING.md T5.12.

**Count: 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW. Verdict: APPROVED.**

## Checked
- **T5.12 fails on the old code (asked for by the orchestrator):** with main's `scanFlow.ts` on 521bcdc, **6/11
  fail**, including "complete event lost (SPC-25): a later re-read resolves it", about:blank, timeout cleanup,
  slow-read overlap, closed tab, and retry. 11/11 pass on the PR. The five that pass on main are behaviour main
  already had (before/during/after, other tabs).
- **Settle once:** `done()` is guarded by `settled`, and clears both timers and both listeners. A read in flight
  when it settles can neither reschedule (`!settled`) nor settle twice. The re-check is chained, so a slow `get`
  is never overlapped.
- **The deviation (an absent `url` counts as loaded): accepted.** Main resolved on any `complete`, so this is no
  worse than main. A visible `about:blank` or any `pendingUrl` is still rejected, and the hidden-url case is the
  only one where we can't tell. The `onUpdated` call without a `tab` argument trusts the event, which is main's
  behaviour.
- **Fast close:** `No tab with id` → "The tab was closed" → the existing `friendlyScanError` branch. Other read
  errors are retried until the 30 s bound. The timeout text is mapped to a fixed sentence.
- **Workaround removed:** `rememberMobileWindow` → `remember()` catches every error, so awaiting it before the
  popup's `try` can't throw and leak the window. The record is now strictly ordered set → clear.
- No permission, storage, schema or protocol change.

## Note (existing behaviour, no action in this PR)
- `rescanUrl` leaves the tab it opened when the load times out or the scan fails. The PR now shows a clear
  timeout text, but the stray tab stays. Possible follow-up: close the tab on failure (orchestrator's call).
