# SPC-26 handoff: the side panel forgets everything when closed

Executor session: `spc-26-81` · Branch `exec/spc-26` (from origin/main d279592) · Lane B · PE `pe-99` · Orchestrator `specimen-53`

## Plan (APPROVED by pe-99 2026-10-15 with changes P1–P3, folded below)

### What exists today
- The panel state is an in-memory zustand store (`sidepanel/store.ts`); closing the panel throws it away.
- Every tab scan is already saved to the Library (`scanTab` → `saveScan`, Dexie db `specimen`).
- The Ask history is already persisted per scan (`db.chats`, written by `saveChat` after each answer, read by
  `Ask.tsx` through `loadChat` when a scan with no in-memory chat is shown). So **restoring the scan restores the Ask
  answers for free**; no new chat storage.
- The council persists itself (`councilDb`, SPC-24). Not touched.

### Approach
**A. Light UI state** in `chrome.storage.session` (in memory, extension-only, cleared when the browser quits; the
`storage` permission is already held). Key `panel.last.<windowId>` (one per window, since each window has its own
panel):
`{ scanId, activeTab, askMode, at }` (built smaller than first planned: the URL and tab id aren't needed, the URL
check uses the Library row). No page text, no chat, no keys. Written by a store subscription
whenever `scan.id`, `activeTab` or `askMode` changes (only once a scan is shown; skipped in `?demo=1`).

**B. Restore on mount** (new `sidepanel/restore.ts`, called from `App.tsx` once, not in demo mode):
1. Await the chat scrub (C) so nothing reads old chat rows first (errors are swallowed; restore still runs).
2. Read the active tab of the panel's window: `chrome.tabs.query({active:true, currentWindow:true})` → `{id, url}`.
   `url` is present once site access is granted (no `tabs` permission needed or added); it can be undefined.
3. Pick a scan:
   - **URL known:** the session's `scanId` if its row exists and `sameUrl(row.url, tabUrl)`; else the newest Library
     scan with `sameUrl(row.url, tabUrl)` and `scannedAt` within **24 h** (`db.scans.where('host')`, filtered with
     `sameUrl`, rows through `migrate()` as `listScans` does). Else nothing.
   - **URL unknown** (no site access yet): **do not auto-apply.** If the session (or the newest Library scan) has a
     scan, the Scan tab shows an offer "Last scan: <host> · Open" (calls `openScan(scan,'saved')`). The ticket allows
     the last scan when the URL is unknown; I propose an offer instead because the tab may be another site (the
     ticket's own "no stale scan" check). **PE: confirm.**
4. Apply only if the user hasn't started anything meanwhile (`scan === null && status === 'idle'`), via `openScan`:
   origin `'tab'` when it matched the active tab's URL (with `extras.tabId = tab.id`, so dark capture and "Add another
   page" work against the same page; hints are gone so theme capture shows its existing idle/none state), screenshot
   from `thumbDataUrl`. Active tab and askMode come from the session **only if** the session's `scanId` is the restored
   one; otherwise `activeTab = 'inspect'` (a found scan on the Scan tab would look like nothing was restored).
5. URL changes **while the panel is open** are not tracked (today's behaviour: a scan stays until you scan again);
   "ignore restored state when the URL changes" is applied at reopen: a different URL never restores the old scan.

**C. One-time scrub of stored Ask history** (override comment, audit H5), new `lib/chatScrub.ts`:
1. Skip if `chrome.storage.local['migrations.chatScrub'] === 1`.
2. `knownKeys`: every `secrets.*` entry in `storage.local`, each read through `loadKey()` (plain or, if this session is
   unlocked, decrypted). Kept in a local variable only, never logged, never written, dropped after the call. A
   locked (encrypted, not unlocked) key sets `partial = true`.
3. **(P2)** Keys are all read *before* the transaction opens. One Dexie `rw` transaction over `db.chats` that awaits
   nothing but Dexie (a foreign await would auto-commit IDB mid-scrub). Per message:
   - `error` → full `scrubLegacyProviderText(text, knownKeys)` (it is meant for error text).
   - **(P1)** assistant `content` → exact known-key redaction only (verbatim and URL-encoded, keys of 8+ chars), via a
     small local helper in `chatScrub.ts`; the shape rules would mangle real answers (hashes, ids).
   - user messages untouched. Rows that change are written back.
4. On commit: set the marker **only if `!partial`**. With a locked key the pattern-based scrub still runs every panel
   open until a run with all keys readable sets the marker (the scrub is idempotent, so re-runs are safe).
5. **(P3)** Gate: `db.ts` gets `whenChatsReady(p)`; every accessor of chat text awaits it. Audit of `db.chats` users
   (grep 2026-10-15): `loadChat` (the only reader of chat text, used by Ask.tsx) and `saveChat` (writer) are gated;
   `deleteScans` only `bulkDelete`s by id (no text read, not gated, and a delete inside the scrub's window is safe);
   `libraryIO` export/import do not touch `chats`; `councilDb` is a separate database.
6. `catch` without logging the error (a Dexie error could quote row text): no marker, retried next open.

### Failure modes
| Case | Behaviour |
|---|---|
| Stale URL (tab now on another page/site) | No restore; Scan tab as today. Same host, different path: no restore. |
| Fresh scan for this URL but older than 24 h | No restore (stale design). |
| Empty DB / first run | Nothing restored, no error. |
| DB error (IDB unavailable, private mode, quota) | Restore and scrub catch; panel opens empty as today. |
| `storage.session` throws / missing | DB-only restore by URL; tab defaults to Inspect. Writes are try/catch. |
| Scan deleted from the Library (session points to it) | `db.scans.get` misses → falls back to URL lookup → else nothing. Its chats were deleted with it. |
| Row fails `migrate()` (old schema) | Skipped like `listScans`. |
| Scrub fails halfway | Single transaction: all or nothing; no marker; next open retries. |
| Scrub runs twice / concurrently (two windows open panels at once) | Idempotent text transform; transactions serialize; both may set the marker. |
| Key locked during scrub | Pattern scrub now; exact-key scrub when a later open has the key; marker waits. |
| Different window | Own session entry and its own active tab; window A's state never applies to window B unless B's tab has the same URL (then the Library lookup finds it, which is correct). |
| Different tab, same window | Uses that tab's URL; previous tab's scan only if same URL. |
| User clicks Scan before restore finishes | Guard in B4: restore doesn't overwrite. |
| Answer streaming when panel closes | Lost (saveChat runs at the end of an answer); the question before it is kept only if an earlier answer saved it. Documented, not fixed. |
| Unsaved scan (Library save failed) | Not restorable; no row. |
| Composed / Library-opened scan | Restored only if its URL matches the active tab (session id first). Otherwise not. |

### Privacy (what is stored, where, how long)
- New: `chrome.storage.session` `panel.last.<windowId>` = scan id, tab name, ask mode, timestamp. In
  memory only, this extension only, gone when the browser quits. No page text, no chat, no keys.
- New: `chrome.storage.local` `migrations.chatScrub = 1`, kept until uninstall.
- Unchanged: scans, thumbnails and Ask history already in IndexedDB `specimen` until the user deletes them.
- Keys are read only in memory during the scrub and passed to a pure function; never stored, logged or sent.
- No new permissions; nothing leaves the device.

### Files (lane B owns store.ts, App.tsx, db.ts)
- `sidepanel/store.ts`: nothing structural; maybe `openScan` takes an optional `extras` patch.
- `sidepanel/App.tsx`: call `restorePanel()` + start the session writer in the mount effect.
- `sidepanel/restore.ts` (new): pick/apply/persist logic; `views/Scan.tsx`: the "Last scan" offer (small). **Scan.tsx
  is SPC-25's file (merged); OK to touch?**
- `lib/db.ts`: `findRecentScan(url, maxAgeMs)`, `whenChatsReady`; `lib/chatScrub.ts` (new).

### Tests (proposed IDs; TESTING.md is the PE's)
- **T4.10** (C, jsdom + fake-indexeddb + chrome stub) panel restore: same URL → scan, tab, Ask history shown;
  different URL → no scan; same URL but > 24 h → none; empty DB → none; session points to a deleted scan → URL
  fallback; DB throws → empty panel, no crash; `storage.session` throws → URL-only restore; user scanned during
  restore → not overwritten; URL unknown → offer shown, not applied; window 2 doesn't take window 1's tab.
- **T4.11** (U, fake-indexeddb) chat scrub: a fake key (exact match, custom shape) in `error` and assistant text is
  removed; assistant text with a 40-char hex/alnum run and an `sk-` look-alike that is not a known key stays unchanged;
  user text untouched; marker set; second run is a no-op; a failing write mid-transaction (stubbed
  `put`/`modify` throw) leaves rows unchanged and no marker, then a retry succeeds; locked key → pattern scrub, no
  marker; nothing logged (`console.*` spied, contains no key).
- Council tests and the existing Ask/Library tests stay green.

## Done
- Plan approved by pe-99 (P1 exact-key-only on assistant text, P2 keys read before the transaction, P3 gate all chat readers).
- `lib/chatScrub.ts` + T4.11 (8 tests, written first; the gate test was checked to fail with the gate removed).
- `lib/db.ts`: `whenChatsReady` gate on `loadChat`/`saveChat`; `getStoredScan`, `scansForHost`, `latestScan`.
- `sidepanel/restore.ts` (restore, offer, per-window memo), `App.tsx` wiring (skipped in `?demo=1`), `store.ts` `offer`,
  `Scan.tsx` "Last scan: <host> · Open". T4.10 (12 component tests). T4.10/T4.11 rows added to `docs/TESTING.md`.
- `pnpm gate` green (gitleaks not installed locally; the fake keys are built with `join` so CI's scan stays quiet).

- PR #30 opened (24011b9), linked on SPC-26, specimen-53 told.
- Lens A r1 (pe-99): APPROVED 0C/0H/0M/1L. L1 folded: memoized `startChatScrub()` is called at module load in
  `sidepanel/main.tsx` (not in demo mode) so the chat gate is armed before any child effect; `restorePanel` awaits the
  same promise. New T4.11 test for it.

- Lens B r1 (`docs/sprint/reviews/SPC-26-b-r1.md`): 0C/0H/1M/6L, folded:
  - M1: the memo path now applies the 24 h rule too, and the memo stores `origin`; only a `'tab'` scan is reattached
    to the live tab (`extras.tabId`), a Library/composed scan restores with its origin (banner on, captures off).
  - L1: malformed `db.chats` rows are skipped, so one bad row can't block the scrub forever.
  - L2: a successful unlock in `UnlockBanner` re-runs `scrubStoredChats()` (no-op once the marker is set).
  - L3: accepted limit, written in TESTING.md T4.11 and the PR body: a rotated key in a format with no known shape
    survives in old error text.
  - L4: `readMemo` validates the memo (scanId, origin, tab, ask mode, at); anything else is ignored.
  - L5: `rememberPanel` writes the current state right away, then on changes.
  - L6: accepted: closed windows' memos (ids only) stay in session storage until the browser quits; in the PR.
  - Tests: T4.10 +4 (stale memo, saved origin, foreign memo, early scan remembered), T4.11 +1 (malformed row).

- Rebased on origin/main after #29 (SPC-17): `db.ts` keeps both #29's `DesignScanSchema.parse` on writes and the
  `await chatsReady` gate in `loadChat`/`saveChat`.
- After the rebase, `council.test.tsx` "T3.33 a run started from another window" failed ~1 in 8 runs with the
  restore on, 0/16 with it off: the restore's Library reads (fake-indexeddb) shifted the timing of the council's
  attach. `restorePanel` now returns before any Library read when the panel already shows something (it never
  restores over existing state anyway): 16/16 green. In real use the panel opens empty, so the reads still run
  next to `initCouncil`; the council attaches on `council.started` regardless, so this is test timing, but worth a
  look if that test flakes again.

- CI green on ef29d3e (gate incl. gitleaks, video). Orchestrator (specimen-c8): no new lens-B round; pe-99 doing the
  final check (db.ts, M1 fold, ef29d3e). The owner stops the sprint after SPC-26.

## Next
- Fold anything pe-99 sends, then stand by. Merge is the owner's call (from the main checkout).

## How to resume
Read this file, then `git log origin/main..exec/spc-26`; `gh pr view` for the PR and reviews in `docs/sprint/reviews/`.
