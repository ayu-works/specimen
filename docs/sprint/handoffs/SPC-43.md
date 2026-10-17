# SPC-43 handoff: two open side panels refresh each other's Library

Executor session: `spc-43-b9` · Branch `exec/spc-43` (from origin/main b01ea77) · PE `pe-b2` · Orchestrator `specimen-75`, then `specimen-5c`

Status: **BUILT, `pnpm gate` green, PR open.** Plan APPROVED by pe-b2 2026-10-17 (own-echo re-list accepted).
PE build notes, all done: (a) the sender channel is `unref()`ed (no hang in vitest); (b) `updateScan` on a missing row
sends no ping, tested with the throwing writers and the duplicates-only import; (c) a superseded re-list makes no
object URLs, a newer one revokes the previous list's, and a re-list in flight at unmount makes none (generation
bumped on unmount); a burst test asserts live URLs == shown thumbnails; (d) the Inspect follow-up is in the PR body.

## Plan

### What is wrong today (read from the code)
The Library (`views/Library/index.tsx`) lists scans once on mount (`reload()`) and again only after a write made in
*this* panel (ScanCard `onChanged`, import, clean-up, compose save). Nothing tells a second panel (another window,
same extension origin, same IndexedDB) that the rows changed, so its cards stay stale until it remounts.

### Approach: one "changed" ping, sent from the db writers, re-list on receipt
**New `apps/extension/src/lib/libraryChannel.ts`** (small, no React):
- Channel name `specimen-library`. Message is the constant `{ type: 'library-changed' }`: no ids, titles, urls or any
  page data.
- `notifyLibraryChanged()`: posts the ping on a lazily opened module-level sender channel. Never throws: no
  `BroadcastChannel` (old runtime / test), a constructor or `postMessage` error are swallowed, so a ping can never
  fail or undo a write that already committed.
- `onLibraryChanged(cb, { debounceMs = 150 })` → `unsubscribe()`: opens its **own** channel, ignores any message
  whose data is not exactly that shape, and calls `cb` once per burst (trailing debounce). `unsubscribe` clears the
  pending timer and `close()`s the channel; calling it twice is a no-op. Returns a no-op unsubscribe when
  `BroadcastChannel` is missing.

**`lib/db.ts`**: call `notifyLibraryChanged()` after the transaction of each Library-visible write has
**committed** (after the `await`, so the receiver's re-list sees the new rows): `saveScan` (new scans, from
`scanFlow`), `updateScan` (rename, tags, favourite, and vibe/variants from Vibe/extras, which change the card's
data), `replaceStoredScan` (merge / re-capture from Scan.tsx), `importScans` (only when `imported > 0`),
`deleteScans`, `saveCompose`. Not `saveChat` (chats are not on cards). A write that throws sends nothing.
Putting it in db.ts covers every caller, including `Scan.tsx` and `Vibe.tsx`, **without editing those files**
(owned by #43/#46 and #44). SPC-17's `DesignScanSchema.parse` checks and the v5 re-key logic stay as they are; I only
append a line after each commit. (I found no `knownKeys` scrub in `db.ts` on b01ea77; whatever SPC-26 left there
is untouched, I add lines only.)

**`views/Library/index.tsx`**:
- `useEffect(() => onLibraryChanged(() => void reload()), [reload])`: subscribe on mount, unsubscribe (close) on
  unmount.
- `reload()` gets a generation counter: only the newest call applies its result, so two overlapping re-lists (a
  local write's reload plus a ping) can't land out of order and show the older list. A superseded call revokes the
  object URLs it made instead of leaking them.
- ScanCard.tsx: no change needed (see "in-progress edits" below). Compose.tsx: no change.

### Failure modes
- **Idempotency.** The ping carries no state, only "re-read". Receiving it once or five times gives the same
  screen: `reload()` is a pure re-list. Duplicate / bursty pings (an import, Vibe's chained saves, the soft-cap
  clean-up) collapse into one re-list by the 150 ms trailing debounce.
- **Own echo.** BroadcastChannel also delivers to other channel objects in the *same* panel, so the panel that
  wrote gets one extra debounced re-list after its own `onChanged` reload. I accept this rather than filter by a
  per-panel sender id: it is harmless (idempotent, one extra IndexedDB read), and a sender id would be per JS realm,
  which would also stop the two-instance test from working. The generation counter keeps the two reloads in order.
- **In-progress edit in the other panel is never lost.** A rename/tag edit lives in that ScanCard's own state
  (`edit`, `draft`); cards are keyed by `s.id`, so a re-list re-renders the card with a new `scan` prop but keeps
  the component, its open input, its draft text and its focus (no blur → no early commit). The search `query`,
  `selected` (pruned to ids that still exist, as today), Compose mode and its picks also live in state the re-list
  doesn't touch. Exceptions, by design: if the other panel **deleted** the scan being edited, that card goes away
  (there is nothing left to rename; a late commit would hit `updateScan`'s `!row → return` anyway). Concurrent
  renames of the same scan: last write wins, as with any two writers; both panels then show the winner.
- **Partial failure / ordering.** Ping only after commit; a failed or aborted transaction sends no ping. A ping
  that fails to send leaves the other panel stale (today's behaviour) but never fails the write.
- **Cleanup errors.** `close()` and `clearTimeout` in unsubscribe are wrapped; a timer that fires after unmount
  can't happen (cleared first), so no `setState` on an unmounted Library.
- **Drift between two copies of a fact.** IndexedDB stays the only source; panels hold read caches that the ping
  invalidates. No data travels on the channel, so the two panels can't disagree about content, only about timing.
- **Library not mounted** (other tab open in that panel): no listener; it re-lists on mount as today.
- **Out of scope:** the *open* scan in the other panel's Inspect view (store.ts, not mine to edit). If that scan is
  deleted elsewhere, its "saved" label stays until a save attempt reports it. I'll note it as a follow-up for the
  orchestrator rather than touch store.ts.

### Tests (new `apps/extension/test/libraryChannel.test.tsx`, id **T4.14**, next free; no open PR claims it)
- U: `onLibraryChanged` gets one call for a burst of three pings (debounce); ignores a foreign message
  (`{type:'other'}`, a string); after unsubscribe gets nothing and the channel is closed; `notifyLibraryChanged`
  doesn't throw when `BroadcastChannel` is undefined (stubbed) or `postMessage` throws.
- U: each writer pings after commit (`saveScan`, `updateScan`, `replaceStoredScan`, `importScans` with a new scan,
  `deleteScans`, `saveCompose`); a writer that throws (a bad-hex scan, as in library.test) sends **no** ping; an
  import of only duplicates sends none.
- C (the ticket's check): two `<Library/>` instances rendered side by side on one fake IndexedDB. Delete a card in
  panel A → it disappears from panel B. Rename / favourite in A → B shows the new title / star. A new scan
  (`saveScan`) → appears in both.
- C (edit safety): panel B has a rename input open with typed text; a delete of a *different* scan in A re-lists B
  and B's input is still there with its draft and focus; Enter then saves B's title.
- C: unmounting a Library closes its channel (spy on `BroadcastChannel.prototype.close`) and a ping afterwards
  causes no error / no act warning.
- `docs/TESTING.md`: add the T4.14 row.

### Check
`pnpm gate` green. Owner's manual test in the PR body: open the side panel in two Chrome windows, both on Library;
delete, rename, tag, favourite in one; the other updates within a moment; start a rename in one and delete another
scan in the other: the rename input keeps its text.

### Files
`apps/extension/src/lib/libraryChannel.ts` (new), `apps/extension/src/lib/db.ts`,
`apps/extension/src/entrypoints/sidepanel/views/Library/index.tsx`, `apps/extension/test/libraryChannel.test.tsx`
(new), `docs/TESTING.md` (one row), this handoff. No open PR touches the first four (checked `gh pr diff` of
#39–#46).

## Done
- `lib/libraryChannel.ts` (new), pings in `lib/db.ts` after each committed write, Library subscribes with a
  generation counter. `test/libraryChannel.test.tsx` (T4.14, 10 tests); mutation check: with the subscription
  removed, the 4 two-panel tests fail. TESTING.md row T4.14. `pnpm gate` green.

## Next
- Reviews (PE lens A + lens B), fold findings, owner's manual test.

## How to resume
Read this file, `gh pr list`, and messages from `pe-b2` / `specimen-75`.
