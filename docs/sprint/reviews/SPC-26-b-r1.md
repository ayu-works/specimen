# SPC-26 lens B + privacy/security review, round 1

Reviewer: fresh second reviewer (lens B + privacy + security). PR #30 at `24011b9`. Read: setup.md, SPC-26 + all
comments (overrides: scrub scope, `knownKeys`), handoff, CLAUDE.md Rules, `gh pr diff 30`, and the code around it
(`aiSettings.loadKey`, `scrubLegacyProviderText`, `Ask.tsx`, `Council.tsx`, `extras.ts`, `sameUrl`).

**Count: 0 CRITICAL · 0 HIGH · 1 MEDIUM · 6 LOW.**

Checked and fine:
- **Scrub atomicity:** keys are read before the single `rw` transaction; nothing but Dexie is awaited inside it; the
  marker is set only after the commit and only when `!partial`. A crash between the commit and the marker means a
  re-run, which is idempotent. Two windows: the transactions serialize and the second run changes nothing.
- **Keys:** they exist only in a local variable. The `catch` logs nothing and returns no error text. Nothing is
  written except the rewritten rows and the marker. No network call is made.
- **Gate:** `loadChat`/`saveChat` await `chatsReady`, which is set synchronously when the panel's mount effect calls
  `scrubStoredChats`. The Ask view can't load a chat earlier because `scan` is null until restore or a user action.
- **New storage:** `storage.session` `panel.last.<windowId>` holds ids and names only. Nothing calls
  `setAccessLevel`, so content scripts can't read it. It is cleared when the browser quits. `storage.local`
  `migrations.chatScrub` is kept until uninstall. No new permissions. Nothing new leaves the browser.
- **Wrong site:** with a known URL, the memo and the Library lookup both require `sameUrl` (origin + path + search),
  so a different site or path restores nothing.
- **Deleted scan:** `getStoredScan` misses, then the URL lookup runs, else nothing. **Empty or failing DB:** caught, and the panel opens empty.
- **Race with a new scan:** `untouched()` is checked after the last await and nothing is awaited before `openScan`.
- **Council (SPC-24):** restore doesn't touch it. `Finished` already shows "this verdict is for an earlier scan"
  when the record's scan differs.
- **Labs flag off:** a restored `askMode: 'council'` is ignored by `AskPane` (it renders `<Ask/>`), and every
  `TabId` is visible without the flag.

---

## MEDIUM

### M1. The memo path skips the 24 h freshness check and relabels any scan as a live `'tab'` scan
`restore.ts:80-97`: when `memo.scanId` matches the URL, the scan is applied with no age check (only `findRecentScan`
applies `FRESH_MS`). It is always opened with origin `'tab'` and `extras.tabId`, whatever its real origin.
`storage.session` lives as long as the browser, often days or weeks.

**Failure scenario:**
1. The user opens a 3-week-old Library scan of `example.com/` (origin `'saved'`) or a composed scan whose `url` is
   the first page. The memo now records that scan id.
2. Days later, in the same browser session, they reopen the panel on `example.com/`.
3. The old scan comes back as a live tab scan. Inspect hides the origin banner for `'tab'` (`Inspect/index.tsx:114`),
   so nothing says it is old, saved or composed.
4. "Capture dark" / "Add another page" are enabled against the current tab. `tabStillOnPage` passes (same URL), so
   `updateScan` writes today's dark variant into the 3-week-old (or composed) Library row. That row then holds two
   different moments of the site.

This also goes against the ticket ("within a sensible freshness window").

**Fix:**
- Apply the same `now - scan.scannedAt <= FRESH_MS` to the memo candidate (or use `memo.at`, which is stored but
  never read).
- Store the origin in the memo and restore with it, using `'tab'` + `tabId` only when the memo's origin was
  `'tab'`; otherwise use `'saved'`/`'composed'` so the banner shows and captures stay off.
- Add a T4.10 case: a memo pointing to a > 24 h scan of this URL is not applied, and a memo of a `'saved'` scan
  restores as `'saved'`.

---

## LOW

### L1. A scrub that keeps failing fails open, silently, forever
`chatScrub.ts:57-60`: `row.messages.map` throws on a row whose `messages` isn't an array (an old or hand-imported
row). A `put` can also fail every time on quota. Either way the whole transaction fails on every open, the marker is
never set, and `loadChat` then serves the unscrubbed rows (the gate only waits; it doesn't block).

**Fix:**
- Skip malformed rows inside the loop (`Array.isArray(row.messages)`) so one bad row can't hold back the others.
- Add a test with one malformed row next to one key-bearing row: the key row is scrubbed and the marker is set.

### L2. With a locked key, the scrub can run on every open for good, and it doesn't re-run after unlocking
- A user who keeps an encrypted key and rarely unlocks before opening the panel pays a full `db.chats` read in a
  `rw` transaction on every open, and restore waits behind it.
- Unlocking through `UnlockBanner` mid-session doesn't trigger the exact-key pass until the next open.

**Fix (any one):**
- Re-run `scrubStoredChats()` when the vault unlock succeeds (the `storage.onChanged` listener on `SESSION_KEY`
  already exists in `aiSettings`).
- Or note in the handoff that this is accepted.

### L3. A rotated or deleted key is only removed by its shape
After the leak, a user has most likely rotated the key, so `knownKeys` no longer holds the leaked one.
- A key in a format `KEY_SHAPES` doesn't cover survives in `error` (for example a self-hosted OpenAI-compatible
  key with dashes and no 32+ alphanumeric run).
- The marker is then set, so it is never revisited.

This is inherent to the approach.

**Fix:** state the limit in the PR body's privacy note and in TESTING.md's T4.11 row. Optionally, also add
`[A-Za-z0-9_-]{40,}` in the `error` field only.

### L4. The memo is trusted without validation
`readMemo` casts `got[...] as PanelMemo`. A memo written by a future or older build, for example with a renamed
`TabId`, gets passed to `setTab`. Radix `Tabs` then renders no content, which looks like a blank panel.

**Fix:** check that `activeTab` is in `TABS`, `askMode` is in `{'quick','council'}` and `scanId` is a string;
otherwise treat the memo as `null`.

### L5. A scan made before restore finishes is not remembered
`rememberPanel` subscribes only after `restorePanel()` resolves, which waits for the scrub, the tab query and the DB.

**Failure scenario:** with a slow scrub (L2), the user scans and switches to Generate before the subscription
exists, then closes the panel. The memo is stale or missing, so on reopen the URL lookup opens Inspect instead of
Generate.

**Fix:** subscribe right away in `App.tsx` (the window id comes from `chrome.windows.getCurrent()` or the tab query,
separate from the scrub), or write the current state once when `rememberPanel` starts.

### L6. Memo keys for closed windows are never removed
`panel.last.<windowId>` for closed windows stays until the browser quits. It holds ids only and is small, so this is
noted only for the privacy list ("cleared how?").

**Fix:** optional. Remove the key on `chrome.windows.onRemoved` in background, or document "cleared when the
browser quits" in the privacy section of the PR. The handoff already says so.
