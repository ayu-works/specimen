# SPC-43 lens B, round 1 (PR #47)

Reviewer: fresh lens B, 2026-10-17. Read: setup.md, SPC-43 + both comments, handoff, `git diff origin/main...HEAD`,
full `lib/db.ts`, `Library/index.tsx`, `ScanCard.tsx`, `Compose.tsx`. SPC-47 (Inspect "saved" after a delete
elsewhere) is out of scope and not re-reported.

**Summary: 0 CRITICAL, 0 HIGH, 2 MEDIUM, 3 LOW.**

## What holds
- **Ping after commit:** each ping follows the `await` of a Dexie `db.transaction(...)`, and that promise resolves
  only on the IDB `complete` event. None of these writers is called inside an outer transaction (that would make
  the inner `transaction()` resolve before the real commit). I grepped: every Library write is in `db.ts`, and
  `chatScrub.ts` touches only `chats`, which no card shows.
- **No ping after a failed write, and always one after a committed write:** `importScans` is all or none (one
  transaction, `imported > 0`), and `deleteScans` deletes several ids in one transaction. `updateScan` on a missing row
  returns `false`. Nothing between the commit and `notifyLibraryChanged()` can throw, and `notifyLibraryChanged`
  never throws itself.
- **Data-free:** every message is the constant `{ type: 'library-changed' }`. The channel is limited to the extension
  origin, so content scripts (page origin) can't join it.
- **Unmount mid re-list:** the generation bump in cleanup stops a late `setScans` / `setThumbs`, the debounce timer
  is cleared, and the channel is closed. A panel in a minimized window, or one that resumes after sleep, gets its queued
  message and re-lists. A closed panel re-lists on mount.
- **Tests:** two `<Library/>` roots on one fake IDB, each with its own channel object, plus a separate sender
  object. A ping from the other panel is the only way panel B can update, so the mutation claim (the 4 two-panel
  tests fail without the subscription) is believable. The per-writer unit test pins each db.ts ping.

## MEDIUM

### M1. Leaving a rename you never changed now reverts a rename made in the other window (regression)
`ScanCard.begin()` seeds `draft` from `scan.title` once. `store('title')` compares the draft with the *current* prop:
`if (title && title !== scan.title) await updateScan(...)`. Before this PR, panel B's `scan` prop stayed stale, so an
unchanged draft equalled it and nothing was written. Now the ping updates the prop while the input stays open (which is
what the PR intends: cards keep their state).
**Scenario:** in window B, open Rename on "Linear" (draft "Linear") and type nothing. In window A, rename it to
"Linear app". B re-lists, so B's `scan.title` is now "Linear app" and B's input still shows "Linear". In B, click
elsewhere: `onBlur` → `commit()` → "Linear" !== "Linear app" → `updateScan` writes "Linear". A's rename is silently
lost, and both panels now show "Linear". Nobody typed that change.
Tags are the same, but that bug is older: `store('tags')` always writes, so an unchanged tag editor in B drops a tag A
added a moment earlier. The fix makes it visible, not worse.
**Fix:** record the value at `begin()` (for example `const [from, setFrom] = useState('')`). Write only when
`draft.trim() !== from` (title), or when the parsed tags differ from the tags at `begin()`. This skips a no-op edit
whatever the other panel did since, and keeps last-write-wins for a real edit. Add a T4.14 case: B opens Rename on
the same scan, A renames it, B blurs, and A's title survives.

### M2. Compose in panel B silently loses a source that panel A deleted
Before this PR, Compose worked from B's in-memory list. Now a re-list replaces `scans` while B is in Compose mode
(`mode` survives a re-list).
**Scenario 1:** B picks scan X for Colors, and A deletes X. In B, `byId.get(picks.colors)` is undefined, so
`compose()` quietly falls back to the base's colors. The Colors `<select>` value matches no option and shows blank.
**Save** stores `sources.colors = X`, an id that no longer exists, and nothing tells the user their pick was dropped.
**Scenario 2:** A deletes the base. `base` is undefined, the preview disappears, Use and Save become disabled, and
the "Start from" picker shows blank with no message.
**Fix (small):** in Compose, drop picks whose id is no longer in `byId`, and if `baseId` is gone, fall back to
`scans[0]` (`useEffect` on `byId`). Show a one-line note, e.g. "A scan you picked was deleted in another window".
Or, if you'd rather not touch Compose.tsx in this ticket, file it as a follow-up next to SPC-47 and say so in the PR
body.

## LOW

### L1. Every ping swaps every thumbnail's object URL in every open Library
`reload()` revokes all old URLs and creates new ones for every blob, inside the `setThumbs` updater, on every ping,
including the panel's own echo. So any write anywhere (a scan, a Vibe save, a variants save, a favourite) makes each
open Library read every thumbnail row and repoint every `<img>`. The old URL is revoked during render, before the new
`src` is committed. With hundreds of cards and several windows, that means a visible flicker and re-decoding all the
images per write. The side effects inside a state updater also leak one full set of URLs per re-list under
`React.StrictMode` (`sidepanel/main.tsx` uses it, and dev double-invokes updaters). The pattern predates this PR,
but the PR multiplies how often it runs, and the burst test doesn't render in StrictMode.
**Fix:** keep a `Map<scanId, url>` in a ref. On re-list, create URLs only for new ids and revoke only removed ids (a
scan's thumbnail never changes under the same id: `replaceStoredScan` leaves it alone, and a re-key moves it). Do
this outside the updater, then `setThumbs(new Map(ref))`.

### L2. A failed background re-list wipes the visible list, and the error never clears
Before, `reload()` ran only after a user action. Now a ping can trigger it at any time. If `listScans`/`thumbBlobs`
throws once (a transient `DatabaseClosedError`/`InvalidStateError`), the catch sets `scans` to `[]` (the empty
state, "Scans you make are saved here") and a sticky "Library is unavailable" alert. A later successful re-list
brings the cards back but leaves the alert up.
**Fix:** for a re-list that came from a ping, keep the last good list on failure (only the first load should show
the unavailable state). Or clear that one message on the next success, without touching other errors.

### L3. Test gaps for the races the plan claims to handle
- No test covers edits to the *same* scan in both panels (see M1).
- No test makes an older re-list resolve after a newer one. If you remove the generation counter, every current test
  still passes, because the leak test passes with or without it. Add one: delay `listScans` for the first call (a
  spy that resolves late), trigger two re-lists, and assert the newer list is shown.
- Both "panels" share one JS realm and one module-level `sender`, so the test can't show that two real documents
  talk to each other. BroadcastChannel guarantees they do, so this is minor. A cheap Playwright check would close the
  gap: open `sidepanel.html` in two tabs, delete in one, and the card disappears in the other. Optional.
