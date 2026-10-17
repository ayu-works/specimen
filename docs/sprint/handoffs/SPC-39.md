# SPC-39 handoff: Library Delete visible up front; the ⋯ menu no longer clipped

Executor session: `spc-39-52` · Branch `exec/spc-39` (from origin/main 2bac238) · Lane A · PE `pe-8a`, then `pe-4d` · Orchestrator `specimen-6a`

Status: **r1 reviews folded (lens A pe-4d 0C/0H/1M/0L; lens B 0C/0H/5M/5L), waiting for r2.** Was: BUILT, PR #38 open. Plan APPROVED by pe-8a 2026-10-17 (Q1 no bulk
delete; Q2 T4.12 C + T4.13 E OK; Q3 files free). Build notes from the approval (on SPC-39), all done: the failing-delete
test asserts the thumb and chat rows survive; the confirm shows the title as plain text; the e2e hit test covers a
left-column card and the last row.

**Correction to the plan:** item 4 below (stale selection) was wrong. `reload()` already prunes `selected` to stored
ids (`index.tsx:51`), so I did not change `index.tsx`. The Export-count test stays as a regression check.

## Plan (APPROVED by pe-8a 2026-10-17)

### What is wrong today (read from the code)
1. `ScanCard.tsx:121`: the card root has `overflow-hidden`; the ⋯ menu is `absolute top-full` inside it, so every
   item below the card's bottom edge (Delete is last) is cut off. That is the owner's "there is no delete button".
2. Second clip the ticket doesn't name: the menu is `w-52` (208px), right-aligned to the ⋯ button. In the panel
   (`main.p-3`, 2-column grid) a card is ~144px (320px panel) to ~184px (400px panel) wide, so on the **left column**
   the menu's left edge lands at about −60px … −20px, off the panel. Fixing only `overflow-hidden` would still hide
   the start of every item on left cards.
3. "Multi-select delete" in the kickoff: **there is none today.** The card checkbox is "Select for export"; the only
   bulk delete is the soft-cap clean-up (`index.tsx:139`). I keep selection + export working (see 3 below) and do
   **not** add a bulk "Delete (n)" button unless the PE/orchestrator wants it (question Q1).
4. Latent bug a visible Delete makes easy to hit: `selected` keeps ids of deleted scans, so the Export button says
   "Export (1)" for a scan that is gone, and if every selected scan was deleted, Export downloads an **empty** file
   (`selected.size > 0` → `scans.filter(...)` → `[]`).

### Changes (2 files + tests)
**`views/Library/ScanCard.tsx`**
- A visible trash button (lucide `Trash2`, 14px, same `rounded p-0.5 hover:bg-muted` as ⋯, `hover:text-destructive`)
  in the title row, left of ⋯. `aria-label` and `title` = `Delete <title || host>`. It calls the existing `remove()`
  (same `window.confirm` text, same `write('delete that scan', …)` error path → "Could not delete that scan: …").
  Delete stays in the ⋯ menu too (same handler), so there is one code path.
- Card root: drop `overflow-hidden`; the thumbnail button keeps its own `overflow-hidden` and gets the card's top
  radius (`rounded-t-[inherit]`-style, checked visually) so the image still has rounded corners.
- Menu: anchor it to the **title row** instead of the ⋯ button: the row gets `relative`, the menu becomes
  `absolute inset-x-0 top-full z-20 mt-1` (as wide as the card's content, never wider than the card, so it can't
  leave the panel on either column). Items may wrap (`Check a build against this` on a 144px card).
- Click-outside ref moves from the ⋯ wrapper to the row, so a pointerdown on a menu item isn't "outside" (it would
  otherwise close the menu before the click lands).
- Escape closes the menu (small; today only an outside click does). Optional, I'll drop it if the PE prefers no
  behaviour change.

**`views/Library/index.tsx`**
- Derive `chosen = scans.filter(s => selected.has(s.id))` and use `chosen.length` for the label and `chosen` for the
  export, so deleted ids never count. (Pruning `selected` in `reload()` would be a second copy of the fact; deriving
  avoids the drift.)

Not touched: `db.ts` (`deleteScans` is already one transaction over scans/thumbs/chats), the Compose view, the store.

### Failure modes
| Case | Behaviour |
|---|---|
| Confirm cancelled | Nothing written, card stays, no error. |
| Delete fails (quota, closed DB, hook throws) | `deleteScans` is one rw transaction → nothing half-deleted; the existing alert "Could not delete that scan: …" shows; `onChanged` reloads and the card stays. |
| Double click on trash | `window.confirm` is modal, so the second click can't land until the first resolves; a second delete of a gone id is a no-op `bulkDelete`. |
| Deleting a selected card | Export count/content drop it (derived `chosen`). Deleting the last selected card → Export (all) again, not an empty file. |
| Deleting the scan open in Inspect/Generate | Same as today's menu Delete (unchanged; out of scope). |
| Menu on the last row / left column | Menu is inside the card's width and outside any clip; the page scrolls to reach it (absolute boxes extend the scroll area). Checked in e2e. |
| Edit mode (rename/tags) | The title row is replaced by the input, so trash and ⋯ are hidden while editing (as ⋯ is today). |
| Composed scans | Trash shown (they can be deleted today via the menu); Re-scan still hidden. |

### Tests (new IDs need the PE's OK; rows added to `docs/TESTING.md` Phase 4 in this PR)
- **T4.12 C** `apps/extension/test/libraryDelete.test.tsx` (jsdom, fake-indexeddb, real `db.ts`, `window.confirm`
  stubbed): every card shows a `Delete <title>` button without opening a menu; confirm → card gone and the row,
  thumb and chat gone from the DB; the confirm text names the title; cancel → card and row stay; a failing delete
  (`db.scans.hook('deleting')` throws a QuotaExceededError) → alert "Could not delete that scan: …" and the card
  stays; the ⋯ menu's Delete still works; selecting a card then deleting it → the Export button loses its count;
  rename / tags / favourite / Re-scan / Check menu items still fire (pointerdown on an item doesn't close the menu
  before the click).
- **T4.13 E** in `e2e/phase4.spec.ts`: two scans (as T4.09), panel at 320×900 (the narrowest side panel); for each
  card open ⋯, and for **every** menu item assert its box is inside the viewport horizontally, and that
  `document.elementFromPoint` at the item's centre (after `scrollIntoViewIfNeeded`) is the item itself (a clipped
  item fails this: hit-testing respects overflow clipping); then click the trash on one card, accept the dialog,
  and see one card left.
- Existing T4.07 / T4.08 / T4.09 stay green unchanged.

### Questions for the PE
- **Q1** Add a bulk "Delete (n)" next to Export for selected cards? My default: **no** (the owner asked for a
  per-card control; the ticket's "keep multi-select delete" refers to something that doesn't exist).
- **Q2** OK to take T4.12 (C) and T4.13 (E)?
- **Q3** Lane: `ScanCard.tsx` / `index.tsx` were Lane C's "Owns" for SPC-19 (merged in #31–#35). I assume they are
  free now; please confirm no active lane holds them.

### Owner's manual steps (for the PR body)
1. Build the branch (`pnpm build`), load `apps/extension/.output/chrome-mv3`, scan two pages.
2. Library tab: each card shows a trash icon next to ⋯. Hover: "Delete <title>".
3. Click trash → confirm dialog → OK: the card is gone. Cancel: it stays.
4. Open ⋯ on the left and the right card, and on the last card: all six items (Rename … Delete) show in full.
5. Tick a card's checkbox, delete that card: Export no longer shows "(1)".

## Done
- `ScanCard.tsx`: visible trash button (`Delete <title>`, same `remove()`), card root without `overflow-hidden`
  (thumbnail clips itself, `rounded-t-[inherit]`), menu anchored to the title row (`inset-x-0`), click-outside ref
  on the row, Escape closes the menu.
- `test/libraryDelete.test.tsx` (T4.12, 8 tests); `e2e/phase4.spec.ts` T4.13; rows in `docs/TESTING.md`.
- T4.13 checked against the old `ScanCard.tsx`: it fails (`box.x` = −60 on the left-column card at 320px), so the
  test catches the clip.
- `pnpm gate` green (209 extension tests, 52 e2e, check-ids 112).

## Review round 1 (folded in one commit, as specimen-6a asked)
| Finding | What I did |
|---|---|
| A-M1 T4.13 passed with `overflow-hidden` back (script scrolls the card) | Removed `scrollIntoViewIfNeeded`; T4.13 now asserts no box between the menu and the page scroller has scrollTop/scrollLeft ≠ 0. **Mutation run** (`overflow-hidden` re-added to the card root, `node scripts/e2e.mjs e2e/phase4.spec.ts -g T4.13`): **red** ("scrolled boxes on card 0"). Real code: green. |
| B-M1 open menu covers the next card, stays open when focus leaves | A `focusout` listener on the title row (while the menu is open) closes it when focus leaves the row. Test. |
| B-M2 18px targets, no gap | Icons are `size-6` (24px) with `gap-1`. |
| B-M3 focus lost after Escape / delete | Escape refocuses ⋯. After a delete, Library focuses the trash of the card now at the deleted index (or the previous one, or the search box). A `Deleted "<title>"` toast is shown. Tests (C + E). |
| B-M4 last-row menu opens below the fold; T4.13 hid it | On open, the menu is scrolled into view (`block: 'nearest'`). T4.13 now places each card at the viewport bottom (320×520) and asserts `toBeInViewport({ratio: 1})` for every item with no manual scroll. |
| B-M5 deleting the open scan still says "Saved scan"; later saves silently go nowhere | After a successful delete of the open scan: `origin: 'tab'` and `saveError: 'it was deleted from your Library'`, so the banner goes and the Scan tab says "Not saved to Library: it was deleted from your Library…". Tests (open scan / other scan). |
| B-L1 delete error only at the top | `write()` failures are also toasted. Test. |
| B-L2 focus rings | `focus-visible:ring-2 ring-ring` on the icons; menu items use an inset ring plus `bg-muted`. |
| B-L3 `role="menu"` with no keyboard model | Focus goes to the first item on open; ArrowUp/Down, Home and End move between items; items are `tabIndex={-1}` (Tab leaves the menu, which closes it). Test. |
| B-L4 two panels don't refresh each other | **Not done** (predates the PR): a follow-up for the orchestrator (a `BroadcastChannel` ping from `deleteScans`/`updateScan`). |
| B-L5 thumbnail radius 1px too big | `rounded-t-[7px]` (the card is the default `rounded-lg`, 8px; no radius tokens in `tailwind.css`). |

## Next
- r2 reviews; owner's manual test; owner merges.

## How to resume
Read this file; branch `exec/spc-39`; `pnpm i`; continue from "Next".
