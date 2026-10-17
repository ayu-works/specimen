# SPC-38 lens A r1 (PE pe-b2, 2026-10-17)

PR #46 @ fa69590, base `exec/spc-44`: `Scan.tsx` (≈15 lines), `test/scanStale.test.tsx` (T1.37), and the TESTING.md row.
scanStale.test.tsx: 7/7 green here.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW.**

## Checks
- **The misleading success is fixed:** `stale = status === 'error' && !!scan` is worked out at render and never stored,
  so it can't disagree with the store. `fail()` is only called from `runTabScan`. The label sits inside the card and
  the alert sentence is inside `role="alert"`, so neither can be read apart from what it describes.
- **The label always clears:** a retry (`scanning`) → gone (test 4). A success → new card (test 3).
  `openScan` → gone (test 7). A failure with no scan → alert only, no "card below" (test 5).
- **My plan note is pinned:** test 2 runs "Add another page" on the stale card. It merges into the previous scan's id
  in both the store and IndexedDB.
- **#33's save-error line still shows on a stale card** (test 6). SPC-20's alert texts are unchanged, with one
  sentence appended.
- The button reads "Scan this page" (instead of the plan's "Try again"). That's clearer and runs the same `run` handler.
- **The tests can fail:** on the base branch, test 2 finds no `previous-scan` label and no `data-stale`.
