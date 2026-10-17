# SPC-39 lens A review, round 1

Reviewer: PE pe-4d (lens A) · PR #38 · head 71c3703 · 2026-10-17
Scope: `ScanCard.tsx`, `test/libraryDelete.test.tsx`, `e2e/phase4.spec.ts` T4.13, TESTING.md T4.12/T4.13, handoff.

**Count: 0 CRITICAL · 0 HIGH · 1 MEDIUM · 0 LOW. Verdict: changes requested (M1 only, test-only).**

## Checked, no finding
- **One delete path:** the trash button and the menu's Delete both call `remove()`; it uses the same confirm text, the
  same `write('delete that scan', …)` path and the same `onChanged` reload.
- **Atomicity:** `deleteScans` is one rw transaction over scans/thumbs/chats. Probe: with the transaction removed,
  the "delete that fails" test goes red (Linear disappears), so that test does guard the rollback.
- **Selection:** `reload()` already prunes `selected` to stored ids (`index.tsx:51`), so leaving `index.tsx`
  untouched is correct. The Export-count test is a valid regression check.
- **Title as text:** the confirm message is plain `window.confirm` text; aria-label/title are attributes. Tested with
  an `<img onerror>` title.
- **Menu/outside-click:** the ref moved to the title row, so a pointerdown on an item isn't "outside" (tested).
  `begin()` closes the menu before the row unmounts in edit mode, so the stale-ref case can't arise. The Escape
  listener is added only while the menu is open and removed in cleanup.
- **Left-column clip:** T4.13 on main's `ScanCard.tsx` fails (`box.x` = −60), so that half of the test is real.
- No permissions, storage, schema or message-protocol changes.

## MEDIUM

### M1. T4.13 passes with the card's `overflow-hidden` put back, so it doesn't guard the bug the owner reported
`item.scrollIntoViewIfNeeded()` also scrolls **the overflow-hidden card itself** (script can scroll an
`overflow:hidden` box, though the user can't). Probe: PR code with `overflow-hidden` re-added to the card root →
T4.13 **passes**. The card's `scrollTop` reaches 102 / 139 / 172 for Tags…Delete on every card, so the "clipped"
item is scrolled into view inside the card, and `elementFromPoint` then hits it.
**Scenario:** a later restyle re-adds `overflow-hidden` to the card (it's the usual way to round a thumbnail), and
Delete is cut off again for every user. The gate stays green.
**Fix:** after `scrollIntoViewIfNeeded()`, assert nothing inside the panel's scroller was scrolled to reach the
item, e.g. `expect(await card.evaluate((c) => c.scrollTop + c.scrollLeft)).toBe(0)`. A sturdier option is to walk
`item`'s ancestors up to the scroll container and require `scrollTop === 0 && scrollLeft === 0` on each. Then re-run
the mutation (re-add `overflow-hidden` to the card root) and confirm T4.13 goes red. Note the red run in the handoff.
Do the run through `node scripts/e2e.mjs` (it builds `.output-e2e`).

## Fold check (pe-4d, 2026-10-17): lens A + lens B r1 fold @ 76bb1a1, APPROVED (0 new findings)
- **A-M1:** T4.13 no longer scrolls items by hand, and it asserts that no box between the menu and the page
  scroller is scrolled. Re-run myself: with `overflow-hidden` back on the card root, T4.13 is red ("scrolled boxes
  on card 0"); the real code is green. libraryDelete 14/14.
- **B-M5 (data):** the store flip (`origin: 'tab'`, `saveError`) only changes Inspect's banner. Live captures depend
  on `extras`, so nothing new unlocks. Later writes for the deleted id stay harmless: `updateScan` does nothing when
  the row is gone, and `saveChat` checks the row exists, so there's no orphan chat row. The one re-save path is
  Scan's "Add another page" (`replaceStoredScan` upserts). It's an explicit user action and it clears the banner,
  so the UI stays accurate.
- `onDeleted` runs only after `deleteScans` resolves, so a failed delete moves no focus and shows no "Deleted" toast.
- B-M1–M4, L1–L3, L5: each maps to a change and a test. L4 (two windows) is a follow-up, as agreed.
