# SPC-38: a failed scan shows the previous scan's card underneath

Executor `spc-38-63` · branch `exec/spc-38` (stacked on `exec/spc-44` 4b2abe2, PR #43, itself on #39) · PE `pe-b2` · orchestrator `specimen-75`.
Status: **built, `pnpm gate` green, PR open.** Plan approved by pe-b2 on 2026-10-17. Linear has no comments (no overrides).

## Plan

### The bug
`runTabScan` → `fail(msg)` sets `status: 'error'` and keeps `scan`, `screenshot`, `favicon` in the store (on purpose:
Generate / Inspect / Ask still work on it, and it may only live in memory if its Library save failed, #33).
`Scan.tsx` renders the red alert and then the full result card for the old scan with no label, so after a failed
scan of page B the panel looks like B was scanned (host, thumbnail, "Generate prompt").

### Choice: keep the card, label it clearly as the previous scan (not hide it)
Why not hide:
- Hiding it removes the only route back to a scan that may not be in the Library (save failed, #33's `saveError`,
  or a merged "Add another page" scan). The user would lose it from view while Generate/Inspect still silently use it,
  which is its own drift between what the panel says and what the tabs use.
- Hiding also removes Re-scan from the card; we'd have to re-add a retry button in the error state.
- Clearing `scan` in the store on failure is worse: it throws away the user's work and changes the restore memo (T4.10).

What changes in `Scan.tsx` only (no store change):
- `const stale = status === 'error' && !!scan;`
- When `stale`, the card gets `data-stale="true"`, a muted look (`opacity-70`), and a first line inside it:
  **"Previous scan, not this page."** with `data-testid="previous-scan"` (role `note`), followed by the host as now.
  The time line stays (it shows when the old scan was taken).
- The red alert, when a card is below it, adds one sentence: "The card below is your previous scan." So the alert
  itself (read by screen readers) says it.
- The Re-scan button reads "Scan this page" while stale (same `run` handler), so the retry is the obvious action. (Not "Try again": the mobile row in the same card already has a "Try again" button.)
- The cheer mascot can't fire on a failure (it only fires on a new `scan.id`); unchanged.
- The label goes away as soon as `status` leaves `error`: `start()` (retry; status `scanning`), `succeed()` (new card,
  new id), `openScan()` (Library/restore sets `done`).

Kept as is: #33's `saveError` line (still shown inside the stale card: it is still true of that scan), SPC-20's
`friendlyScanError` texts in the alert (unchanged; I only append a sentence when a card is shown), SPC-25/SPC-44's
fullscreen "skipped in full screen" + "Try again" in `Captures` (untouched).

### Files
| File | Change |
|---|---|
| `apps/extension/src/entrypoints/sidepanel/views/Scan.tsx` | the stale label, alert sentence, button text (≈15 lines) |
| `apps/extension/test/scanStale.test.tsx` (new) | T1.37 tests below |
| `docs/TESTING.md` | new row T1.37 (C). Free on every open branch (checked `exec/*` diffs: only T0/T3/T5 rows added) |

Not touched: `store.ts`, `runScan.ts`, council.test.tsx (#41), `test/helpers/chrome.ts` (#40, I only import it),
Vibe.tsx (#44), llmHost.ts / LocalGemma.tsx (#42).

### Tests (T1.37, component, jsdom, `installChrome` + fake-indexeddb, `sendMessage` stubbed; no real URL)
Driven through the real `runTabScan` and the real `<Scan />`, like `scanSave.test.tsx`:
1. Scan stripe.com succeeds → card shown, no `previous-scan` label, no `data-stale`, button "Re-scan".
2. Then the active tab is `chrome://settings` (or the background rejects) → alert with SPC-20's fixed text plus
   "The card below is your previous scan."; the card is still there with the "Previous scan, not this page." label,
   `data-stale="true"`, still names stripe.com (not the failed page), button "Try again".
3. Retry that succeeds (on another fixture host / same stripe) → alert gone, label gone, card shows the new scan
   (new id / time, host of the new page), button "Re-scan".
4. During the retry (`status: scanning`) the label and alert are gone (no stale claim while a scan runs).
5. A failure with no previous scan → the alert has no "card below" sentence and no card (empty state unchanged).
6. A stale card whose save had failed (#33) still shows the `save-error` line and the label.
7. Opening a Library scan after a failure (`openScan`) clears the label.

### Failure modes
- **Misleading success (the bug):** covered by 2; the label is inside the card, so it can't scroll apart from it.
- **Drift between two copies of a fact:** "stale" is derived from `status` + `scan` at render, never stored, so it
  can't disagree with the store. No new state.
- **Concurrency / races:** a scan finishing after another started is already decided by the store (last `succeed`
  / `fail` wins); the label follows whatever status ends up there. Test 4 covers the in-between state.
- **Partial failure:** a scan that succeeds but whose save fails is `done`, not `error` → no stale label (that's
  #33's line, test 6 checks the two together only for a real failure).
- **Atomicity / idempotency / cleanup:** render-only change, nothing written; a second failure keeps the same label.
- **"Add another page" failure:** reported in `extras.note` with `status` still `done`; the card is the right scan
  there (unchanged pages), so no label. Out of scope, unchanged.

### Check
`pnpm gate` green. Owner manual test steps go in the PR body (scan a site, then scan `chrome://extensions` → label;
then go back and scan again → normal card).

## Done
- (r0) `Scan.tsx`: `stale = status === 'error' && !!scan`; label "Previous scan, not this page." (reworded in the lens B fold) (`data-testid="previous-scan"`,
  role `note`), card `data-stale="true"` + `opacity-70`, alert adds "The card below is your previous scan.", button
  "Scan this page" instead of "Re-scan".
- `test/scanStale.test.tsx`: 7 T1.37 tests (plan 1–7). Per pe-b2's note, test 2 also pins that the stale card's
  "Add another page" merges into the previous scan's id (store and Library row).
- `docs/TESTING.md`: T1.37 row.
- `pnpm gate` green on 2026-10-17 (gitleaks not installed locally, so `secrets` skipped; CI runs it).

## Next / how to resume
- Lens A r1 (pe-b2): APPROVED, 0 findings (`docs/sprint/reviews/SPC-38-a-r1.md`).
- Lens B r1 (`docs/sprint/reviews/SPC-38-b-r1.md`, 1H 2M 4L) folded in one commit:
  - H1: `useShortcut.consume` switches to the Scan tab when the shortcut's scan ends in `error`, so the alert and
    label are what the user sees (reviewer's smallest option; no Generate.tsx or store change). Tests: a failing
    shortcut lands on Scan with the alert + label; a working one stays on Generate. Checked the test fails without the fix.
  - M1: the label is a full-strength chip (`border-destructive/40`, `text-destructive`, the alert's style); the card's
    `opacity-70` is gone, the card gets a dashed border instead. No tinted fill: 10% red behind small red text drops
    below 4.5:1 on the light theme.
  - M2: a stale card is `role="region"` named by the label (`aria-labelledby`), and "Generate prompt" reads
    "Generate prompt (previous scan)". "Add another page" keeps its text: it does add the current tab, to that scan.
  - L1: the "card below" sentence is its own block line. Test with an unmapped error.
  - L2: label reworded to "Previous scan: <host>. The last scan failed." (true whatever tab is active).
  - L3: skipped. The "Click Scan again" wording is SPC-20's alert text, which this ticket keeps unchanged; flagged for
    a later text pass.
  - L4: test with a background failure (timeout) after a success.
- Next: gate + CI green, then pe-b2 fold check and tell specimen-75.
