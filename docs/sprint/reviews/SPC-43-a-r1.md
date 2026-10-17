# SPC-43 lens A r1 (PE pe-b2, 2026-10-17)

PR #47, base main: `libraryChannel.ts` (new), `db.ts` (a ping after each committed Library write), `Library/index.tsx`
(subscribe + generation counter), `test/libraryChannel.test.tsx` (T4.14), and TESTING.md. T4.14: 10/10 green here, with no hang.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW.**

## Checks
- **Ping only after commit:** each `notifyLibraryChanged()` comes after the awaited `db.transaction`, so a thrown or
  aborted transaction never pings. `updateScan` returns `false` for a missing row and doesn't ping (my note b).
  `importScans` pings only when `imported > 0`. No other write path reaches `scans`/`thumbs` outside db.ts
  (`chatScrub` only writes chats, which aren't on cards).
- **No data on the channel:** the message is the constant `{type:'library-changed'}`, and the receiver ignores any other
  shape (tested). Privacy: nothing about a scan crosses panels except "re-read".
- **Never fails a write:** `notifyLibraryChanged` swallows every error, including a missing `BroadcastChannel` and a
  throwing `postMessage` (tested). The sender is `unref`'d, so vitest doesn't hang (my note a).
- **Ordering and leaks:** the generation counter drops a superseded re-list *before* `setThumbs`, so it makes no object
  URLs. An applied re-list revokes the previous list's URLs (existing updater). Unmount bumps the generation, so an
  in-flight re-list sets no state. Unsubscribe clears the debounce timer and closes the channel, and is idempotent (tested).
  The burst test asserts no leaked thumbnail URLs (my note c).
- **Edit safety:** cards are keyed by id, so a re-list keeps an open rename's draft and focus (tested with two panels).
- **The tests can fail:** on main, panel B never re-lists, so the two-panel delete/rename/new-scan tests fail.
