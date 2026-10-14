# SPC-26 review, lens A, round 1

Reviewer: pe-99 (PE). PR #30, head `24011b9`. 2026-10-15.
**Verdict: APPROVED. 0 CRITICAL / 0 HIGH / 0 MEDIUM / 1 LOW.**
- Condition: CI `gate` must be green on `24011b9`; it was pending when I checked.
- L1 folds without re-review.

## Checked and fine (the 3 plan conditions plus the plan)
1. **Answers vs errors:**
   - `scrubMessage` touches assistant messages only.
   - `content` goes through `redactKnownKeys` only (exact known keys, verbatim and URL-encoded, 8+ characters).
   - `error` gets the full `scrubLegacyProviderText(error, keys)`. User text is untouched.
   - Tested: a real answer with key-like runs stays as it was.
2. **Transaction:**
   - The keys are read (`readKnownKeys`, through `loadKey`) before the `rw` transaction.
   - Inside it there are only Dexie calls plus pure string work, and rows are written only when they changed.
   - A write failing halfway rolls back: every row is unchanged and no marker is set, and a retry succeeds. Tested.
   - `loadKey` reports a decrypt failure as `locked`, so it also holds back the marker.
3. **Gate:**
   - `loadChat` and `saveChat` (the only readers and writers of chat text) await `chatsReady`.
   - `deleteScans` deletes chat rows without reading them.
   - `whenChatsReady` swallows the scrub's rejection, so readers never fail.
   - `scrubStoredChats()` arms the gate synchronously at the start of `restorePanel()`.
- **Nothing logged:** the scrub's `catch` logs nothing, and a test spies on `console`. Keys stay in local variables.
- **The memo:** `storage.session` holds `{scanId, activeTab, askMode, at}`, one per window, with no page text, chat
  or keys. It's written only when that signature changes, and only once a scan is shown.
- **Restore:**
  - It restores only when the URL is the same (`sameUrl`), from the memo first and else from a Library scan of the
    same page within 24 h.
  - When the URL is unknown, the last scan is only offered.
  - `untouched()` is re-checked after the last await, so a scan the user started is never overwritten.
  - Rows go through `toStored` (`migrate`), so v4 repair applies.
  - A restored `askMode: 'council'` only shows the council when the flag is on (`AskPane`).
- **Tests:** T4.10 and T4.11 rows are added, and the tests cover every failure mode listed in the plan.

## L1 (LOW): the chat gate is armed in a parent effect
`whenChatsReady` is set when `restorePanel()` runs, from `Panel`'s `useEffect`. React runs child effects before parent
effects. Today no child calls `loadChat` at mount, because the scan is null until restore applies one, so nothing can
be read unscrubbed. But a future child that loads chat text on mount, such as a Library chat preview, would read
before the gate is armed.

**Fix:** arm it at module load. Call `scrubStoredChats()` from `sidepanel/main.tsx` before rendering (outside demo
mode), and have `restorePanel` await the same promise, for example with a memoized `scrubStoredChats`. No new test
needed beyond the existing gate test.
