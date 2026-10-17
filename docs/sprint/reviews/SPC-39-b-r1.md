# SPC-39 lens B review, round 1 (UI + accessibility)

PR #38 · commit 71c3703 · Reviewer: fresh lens B · 2026-10-17
Read: setup.md, SPC-39 + both comments, `docs/sprint/handoffs/SPC-39.md`, `gh pr diff 38`, `ScanCard.tsx`,
`Library/index.tsx`, `db.ts` (`deleteScans`, `updateScan`, `saveChat`), `Vibe.tsx`, `extras.ts`, `Inspect/index.tsx`,
`tailwind.css`. Static review; I did not run the gate (the executor reports it green).

**Count: 0 CRITICAL · 0 HIGH · 5 MEDIUM · 5 LOW.** The owner's bug is fixed. The menu is no longer clipped on
either column (`inset-x-0` of the title row keeps it inside the card's width), the trash has a clear name, and the
confirm and error paths are the same code as before. M1–M4 are new edges that come from the menu now spilling over
the next row, or from Escape and the trash being new. M5 is older, but a one-click Delete makes it easy to hit.

## MEDIUM

### M1. The open menu now covers the card below it, including that card's trash, and stays open when focus leaves
Before this PR the menu was clipped inside its own card. Now it is `absolute … z-20` and hangs over the next row.
Rough geometry at 320px: the card is about 144 wide and 156 tall, and the menu has 6 items, one of which wraps to 2
lines, so it is about 190 tall. It starts about 132px below the card's top, so it covers almost all of the card
underneath: its thumbnail, its checkbox, and its title row with the trash and ⋯.
The menu only closes on pointerdown or Escape.
**Scenario:** a keyboard user opens ⋯ on card 0 (left column, row 1) and Tabs past Delete. Focus moves through card 1
and then onto card 2's Open, checkbox, **Delete** and ⋯, all hidden under card 0's menu (WCAG 2.4.11 Focus Not
Obscured). If they press Enter on the hidden "Delete card 2", a confirm for a card they cannot see appears. Pointer
users can't reach card 2's controls until they click somewhere to close the menu.
**Fix:** close the menu when focus leaves the row. Add an `onBlur` on the `box` row:
`if (!e.currentTarget.contains(e.relatedTarget as Node)) setMenu(false)`. Add a T4.12 case: open ⋯, then focus moves
outside the row, and the menu is gone.

### M2. The trash and ⋯ are 18×18px targets with no gap between them
`iconCls = 'rounded p-0.5'` around a 14px icon gives an 18px target, and the wrapper is `flex shrink-0` with no
`gap`. A destructive control sits flush against the menu button. That fails WCAG 2.5.8 Target Size (Minimum, AA):
the targets are under 24px, and the spacing exception doesn't apply because 24px circles around them overlap.
**Scenario:** on a touchpad or touchscreen, a user aims at ⋯, hits the trash, and gets a delete confirm they didn't
ask for. The confirm prevents data loss, but this is the most frequent mis-hit on the card.
**Fix:** `p-1` (22px) plus `gap-1` on the wrapper, or `size-6 inline-flex items-center justify-center`. The title
column has `min-w-0 truncate`, so the extra 8px only shortens the visible title.

### M3. Focus is lost after Escape and after a delete
The new Escape handler unmounts the menu while focus is on a menu item. After a confirmed delete, the focused trash
is removed with its card. In both cases focus falls to `<body>`, the next Tab starts from the top of the panel (the
header and tabs), and a screen reader announces nothing.
**Scenario:** a keyboard user deletes the 9th card and has to Tab through the header, tabs, search, Compose,
Export, Import and 8 cards to get back.
**Fix:** keep a ref on the ⋯ button and focus it after closing with Escape (the usual menu-button pattern). After a
delete, focus the next card's trash, or the previous one, or the search box if the list is empty. The simplest
version is an `onDeleted(id)` callback to `Library`, which focuses `[data-testid=library-card]` at the same index
after `reload()`. Optionally add a polite `toast('Deleted "<name>"')` as the confirmation.

### M4. A menu on a card at the bottom of the viewport opens below the fold, and T4.13 hides this
The menu extends the scroll area, but nothing scrolls it into view. **Scenario:** the user scrolls so the last row is
at the bottom of the panel and clicks ⋯. Nothing appears to happen because the whole menu is below the fold. That is
the owner's original complaint ("I cannot see it"), now for Rename, Tags and the rest. T4.13 calls
`scrollIntoViewIfNeeded()` on each item before it hit-tests, so it passes in exactly this case.
**Fix:** when the menu opens, call `menuRef.current?.scrollIntoView({ block: 'nearest' })` in a `useEffect` on
`menu`. Better still, flip it upward (`bottom-full mb-1`) when there's no room below. In T4.13, assert that
`isIntersectingViewport()` holds for the last item **before** any manual scroll, on the last-row card, with the list
scrolled so that card sits at the viewport bottom.

### M5. Deleting the scan that is open in the panel leaves it shown as "Saved scan", and later saves silently go nowhere
Older behaviour, but now it takes one click. `remove()` doesn't touch the store, so after deleting the open scan:
- the header still shows its host;
- Inspect's `OriginBanner` still says "Saved scan · <date>" (`origin` stays `'saved'`);
- the Scan, Inspect and Generate tabs keep working on the in-memory copy, which is acceptable;
- every later write reports success but stores nothing. `updateScan` returns with no error when there's no row
  (`db.ts:200 if (!row) return`), and `saveChat` does the same. So a vibe (`Vibe.tsx:73`) or a variant capture
  (`extras.ts:41`) shows as saved, and the "not saved to Library" note never appears;
- on the next panel open, the restore memo points at a deleted `scanId`.

**Fix (small, in `remove()` after a successful delete):** if `useStore.getState().scan?.id === scan.id`, switch the
store to `origin: 'tab'` (an unsaved working scan), so the banner goes away and the existing "a scan not in the
Library has no row" semantics are honest. Alternatively, make the banner say "Removed from Library". Add a T4.12
case: open scan X, delete X, and the origin banner no longer says "Saved scan". If this belongs in a follow-up
ticket, say so in the PR, because the owner will notice it in the manual test.

## LOW

### L1. A delete error shows only at the top of the Library
`onError` sets the `role="alert"` box above the toolbar. **Scenario:** a delete fails on a card further down a long,
scrolled list. The card stays and nothing visible happens, unless a screen reader announces the alert. The stale
error also stays until another action clears it. **Fix:** also call `toast(message)`, as `Vibe.tsx` already does
for save failures, or scroll the alert into view.

### L2. The focus indication is inconsistent and partly clipped
The trash and ⋯ have no `focus-visible:ring-*` and rely on Chrome's default outline. The thumbnail button and the
search use `ring-2 ring-ring`. The menu container is `overflow-hidden`, so the outlines on full-width menu items are
cut off at the left and right edges. The default outline is visible in both themes, so this is cosmetic. **Fix:**
add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` to `iconCls`. Use an inset ring on
`itemCls` (`focus-visible:ring-inset`) so the menu's `overflow-hidden` can't clip it.

### L3. The menu has `role="menu"` but no menu keyboard model
There are no arrow keys, no roving tabindex, and focus doesn't move into the menu when it opens. Screen readers
announce a menu and then the expected keys don't work. This predates the PR, which only adds Escape. **Fix:** either
implement arrow navigation and focus the first item on open, or drop `role="menu"`/`menuitem` and use a plain
disclosure (`aria-expanded` is already there). The tests query `menuitem`, so they would need updating too.

### L4. Two panels (two windows) don't refresh each other
Window A deletes a scan, and window B's Library still shows the card. In B, the trash is a harmless no-op followed by
a reload that removes the card. A Rename or Favorite in B silently does nothing (`updateScan` with no row), and the
card then disappears on reload. This predates the PR. **Fix (follow-up):** a `BroadcastChannel('specimen-library')`
ping from `deleteScans` and `updateScan` that triggers `reload()`.

### L5. The thumbnail's corner radius is 1px too large
The thumbnail uses `rounded-t-[inherit]`, which gives it the card's outer 8px radius, but it sits inside the card's
1px border. On a dark thumbnail in light mode, a hairline of `bg-background` can show at the two top corners.
**Fix:** `rounded-t-[calc(var(--radius-lg)-1px)]`, or `rounded-t-[7px]`.

## Checked and fine
- **Clipping:** on both columns, the last row and a long title, the menu's width is the title row's width
  (`inset-x-0`), so it can't leave the panel. A long title truncates in `min-w-0` and never pushes the icons out.
  "Check a build against this" wraps at 320px, which is fine.
- **Narrow panel:** at 320px a card is about 144px. The two icons take 36px (44 after the M2 fix), and the title
  still shows.
- **Accidental deletion:** the thumbnail (`Open`), the checkbox and the card body are separate elements with no
  delete handler. Delete always goes through `window.confirm`, which names the title as plain text. Cancel writes
  nothing.
- **Click-outside:** the ref moved to the row, so a pointerdown on a menu item no longer closes the menu before the
  click lands, and the test drives pointerdown then click.
- **Failure path:** `deleteScans` is one rw transaction over scans, thumbs and chats, so on failure all three rows
  stay (tested). The existing "Could not delete that scan: …" text shows, and `onChanged` reloads with the card still
  there.
- **Delete during a re-scan:** `rescanUrl` saves a new row, so deleting the old card while "Re-scanning…" runs is
  safe.
- **Delete during a vibe:** the vibe's `updateScan` finds no row and does nothing. No crash; see M5 for the
  misleading "saved".
- **Selection:** `reload()` prunes `selected` (`index.tsx:51`), so Export drops the count (tested).
- **Contrast (from `tailwind.css`):** muted-foreground icon on the background is about 4.7:1 in light and about
  6.6:1 in dark. The destructive hover is about 4.5:1 on white in light and about 6.5:1 in dark. Hover `bg-muted`
  keeps both above 3:1 for a non-text icon.
- **Other actions:** Rename, Tags, Favourite and Check have a T4.12 test. Re-scan is unchanged apart from moving
  (still hidden for composed scans). In edit mode the trash and ⋯ are hidden with the title row.
