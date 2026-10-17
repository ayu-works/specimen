# SPC-19 lens B + data safety + contract r1 (fresh reviewer, 2026-10-17): PR #33 at 0851801

Reviewed `main...0851801`. That is the pushed c1e4917 plus the local fold of lens A r1, which is not pushed yet.
I read the code, ran the core code directly with `tsx` probes (scratchpad, not committed), and read the tests.

**Verdict: 0 CRITICAL, 0 HIGH, 2 MEDIUM, 4 LOW.** None of these lose a normal user's existing Library on the v5
upgrade. Both MEDIUMs are data-safety edges that this PR creates.

## Checked and OK
- **Upgrade never drops an ordinary row.**
  - Every string, array and record in v5 is built with `str`/`list`/`dict`, so `trimToBounds` can cut anything zod
    would reject. The only exception is the hex pattern, which v4 already enforced.
  - Wrappers (`optional`, `.partial()`, `.extend`, `partialRecord`, the top-level `superRefine`) are walked
    correctly. Probe: a v4 row with 101 warnings → 100, and the last one is the "Trimmed on upgrade" note.
  - Cut palette ids drop only the roles that pointed at them, including variant roles that fall back to the base
    palette.
- **Idempotent, no rewrite loop.**
  - `migrate(migrate(x))` gives the same JSON (probe).
  - Reads (`toStored`) never write. A v4 row is rewritten only by the next real write, and then it is v5, so it is
    never trimmed again.
- **Import atomicity and retry.**
  - Parsing and hashing happen before the transaction. There is one `bulkAdd`, and its rejection aborts the
    transaction.
  - A retry stores each scan once. A third import stores nothing.
  - A clashing id → `<id>-<48-bit hash of content>`. Two *different* scans can only share that id through a
    48-bit collision on the same id prefix, which is negligible. Two scans with the same content collapsing into one
    is the intended behaviour.
  - The `randomUUID` fallback (both candidates taken by other content) is not idempotent. It needs a hash collision
    to reach, so it is fine.
- **Two windows importing at once.** Each import is one `rw` transaction on `scans`, so the two serialise, and the
  `bulkGet` of taken ids runs inside the transaction. The second import sees the first one's rows and counts them as
  duplicates.
- **A v4 export still imports** (T4.03 :318, trimmed). A v5 row over a bound is skipped and counted.
- **db.ts:** `DesignScanSchema.parse` is kept in all 4 writers, and each stores the parsed value. `await chatsReady`
  is kept in `loadChat`/`saveChat`. saveScan writes scan + thumb in one transaction, and the blob is decoded outside
  it.
- **Producers:** extract, merge and compose clamp. Mobile and dark variants come from extract output.
- **500 rows:** with a real extracted scan, `migrate` × 500 takes about 57 ms for v4 rows (walk + parse) and about
  16 ms for v5 rows. That is fine for each Library reload.

## MEDIUM

### M1. Restoring a backup permanently drops CSS variables of merged (multi-page) scans
`importFile` runs every imported scan through `filterCssVariables`, which caps at **200** entries (sorted by name).
`mergeScans` legitimately keeps up to **500** (`BOUNDS.cssVariables`; the ruling's "4 pages × 200 vars").
**Scenario:**
1. The user merges 3 pages of a site whose pages define different root variables, and ends up with 350.
2. They export the Library, then clear the profile or move to a new machine, and import the file.
3. The scan comes back with 200 variables, and the user is not told: the toast says "Imported 1".

The tokens and DESIGN.md generated from that scan change. This is a regression, because before this PR the import
did not filter. T4.02 "round-trips identically" only covers single-page scans.

The 0851801 fold filters both sides of the comparison, so re-importing into the *same* Library no longer adds a
copy. The loss on restore into an empty Library remains.

**Fix:**
- Split the rule. The import applies the name rule (`VAR_NAME`) and the value cap (≤ 200 chars), with the entry cap
  at `BOUNDS.cssVariables` (500), not the per-page 200. For example, `filterCssVariables(vars, max = 200)` with
  the import passing `BOUNDS.cssVariables`. Use the same call on the stored side of `importScans`.
- Test: merge 2 scans with 200 distinct `--color-*` vars each, export, clear, import → 400 vars back.

### M2. A v4 row with an id over 1000 chars upgrades to a *different* id: it can't be deleted or edited, and a merge duplicates it
`trimToBounds` truncates `id` like any other string. Before v5, any id length was accepted, including from imports,
which kept the file's ids. The row's IndexedDB key is still the long id, but `toStored` hands the UI the truncated
one (probe: a 1500-char id → `migrate(...).id.length === 1000`).

**Scenario:** an old import (hand-made, or from a tool) stored a scan with a long id. After the upgrade:
- **Delete** → `deleteScans([truncated])` deletes nothing and throws nothing, and the card comes back on reload.
- **Rename, tag or favourite** → `updateScan` finds no row and returns silently. This is the silent-failure path
  M13 set out to remove.
- **Open, then "Add another page"** → `replaceStoredScan` puts a *new* row under the truncated id, so there are now
  2 rows, and the original is still undeletable.
- Its thumbnail never shows, because the lookup is by the truncated id.

**Fix (smallest):** in `toStored`, return `id: row.id` (the real key), so the UI always addresses the stored row.
In `updateScan` and `replaceStoredScan`, when `migrate(row).id !== row.id`, re-key in the same transaction: put the
new row, delete the old key, and move `thumbs`/`chats`. The alternative is to exempt `id` from the trim, but then
the row is rejected and vanishes, which is worse.
**Test:** a stored v4 row with a 1500-char id → it lists, `deleteScans([listed.id])` removes it, and a rename sticks.

## LOW

### L1. The vibe producer is not inside the v5 bounds, and its save failure is silent
`packages/ai/src/features/vibe.ts:96-103` caps keywords at 8, but it caps neither keyword length (bound 100) nor
`summary` (bound 4000) when the model's JSON parses. A local model that loops, or that returns sentences as
"keywords", makes `updateScan(..., { vibe })` throw a ZodError. `Vibe.tsx:34` swallows that error, so the vibe shows
for this session and is gone after reload. The ruling (§5) says our producers stay inside the bounds.
**Fix:** in `vibe.ts`, `summary.slice(0, BOUNDS.vibeSummary)` and `k.slice(0, BOUNDS.keyword)`. This can be folded
into SPC-33 together with the silent catch, but say so on the ticket.

### L2. A quota failure reported as a `BulkError` shows Dexie's raw text, not "out of storage space"
`libraryErrorText` looks at `name` and `inner.name`.
- A quota abort at commit arrives as `AbortError` with `inner` = `QuotaExceededError`, which is handled.
- When the browser fails the individual add requests instead, Dexie 4 rejects `bulkAdd` with a `BulkError`. It has
  no `inner`, and its errors are in `failures[]`. The user then reads "Import failed, nothing was saved:
  scans.bulkAdd(): 3 of 3 operations failed. Errors: QuotaExceededError…".

The quota test throws a bare DOMException from a `creating` hook, which matches neither real shape.
**Fix:**
- Add `err.failures?.[0]?.name` (and `?.inner?.name`) to `names`.
- Test with `Object.assign(new Error(), { name: 'BulkError', failures: [new DOMException('', 'QuotaExceededError')] })`
  and with `{ name: 'AbortError', inner: DOMException(QuotaExceeded) }`.
- This overlaps lens A L3, which asks for a generic fallback instead of `err.message`.

### L3. "Not saved to Library" stays on screen after the scan *was* saved by a merge
`saveError` is only cleared by `start`/`openScan`.
**Scenario:** the first save fails (a transient quota problem), the user frees space and clicks "Add another page",
and `replaceStoredScan` succeeds and creates the row. The note says "2 pages merged", but the red line above it still
says the scan won't be in the Library.
**Fix:** clear `saveError` in the store when `replaceStoredScan` (or `attach`'s `updateScan`) succeeds for the
current scan. Note that `attach` on an unsaved scan is a silent no-op, because `updateScan` returns when there is no
row. That is consistent with the red line, so leave it.

### L4. Truncation can make two palette ids collide or split a surrogate pair
These are cosmetic and hostile-only. Two palette ids that differ only after char 1000 become equal (probe), and a
role then points at the first one. A title cut at 1000 can end in a lone surrogate (probe: `\ud83d`), which renders
as �. **Fix (optional):** none needed for safety. If touched, back off one char when `slice` ends on a high
surrogate.

## Not findings (already tracked)
- Pre-existing hostile v4 rows (150k palette) are still read whole from IndexedDB and re-trimmed on every Library
  reload until their first write. That is the ruling's §6 follow-up (cache or compact migrated rows).
- Library rescan ignores `saveError` (handoff follow-up). The Vibe silent save is SPC-33.
