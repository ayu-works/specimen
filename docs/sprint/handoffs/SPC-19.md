# SPC-19 handoff: Library writes (import atomicity, silent save failure) + SPC-17 sec M2, L1, L2 (import), L3

Executor session: `spc-19-02` · Branch `exec/spc-19` (from origin/main 77ac925) · Lane C · PE `pe-ed` · Orchestrator `specimen-6a`

Status: **BUILT, PR open, waiting for reviews.** Plan APPROVED by pe-ed 2026-10-17 (answers below). M2 ruling:
`worktrees/pe/docs/sprint/reviews/SPC-19-m2-ruling.md`; owner OK relayed by specimen-6a 2026-10-17 (recorded on SPC-19).

## Plan (APPROVED by pe-ed 2026-10-17)
PE answers: (1) yes, same id + same content is a duplicate (compare parsed values on both sides); (2) leave Vibe.tsx
(PE files a follow-up); (3) M2 numbers fixed in the ruling, plus merge/compose clamp with the same trim; (4)
ScanCard/extras/Scan.tsx OK. Build note: inside Dexie rw transactions await only Dexie calls.

### Scope (from the ticket, its comments and the kickoff)
| Item | Source | Where |
|---|---|---|
| H6 import is not atomic; a retry stores duplicates | audit | `lib/libraryIO.ts`, `lib/db.ts` |
| H7 a failed Library save after a scan is silent | audit | `lib/scanFlow.ts`, `sidepanel/runScan.ts`, `store.ts`, `views/Scan.tsx` |
| M13 rename / tag / favourite / delete failures in the Library card are silent | audit | `views/Library/ScanCard.tsx` |
| M14 import accepts `version: 2`; in-file duplicate ids untested; scan + thumb not one transaction | audit | `libraryIO.ts`, `db.ts` |
| L1 `repairColors` deep-clones the whole untrusted input | sec | `core/schema/migrations.ts` |
| L2 (import side) imported `cssVariables` skip VAR_NAME and the 200-char value cap | sec | `core/extract` (export the filter), `libraryIO.ts` |
| L3 writers validate but store the unparsed object | sec | `db.ts` |
| M2 no per-field bounds; one hostile import slows the Library forever | sec, **contract** | `core/schema/*` |
| (optional, from the 2026-10-15 comment) Library note "N saved scans couldn't be read" | ticket | `views/Library/index.tsx` |

Not in scope: H1/M1 (title regex cost: SPC-32), the DESIGN.md backtick escape (SPC-32), caching migrated rows in
`listScans` (named as optional in M2; bounds make the cost bounded, so I leave it as a follow-up unless the PE wants it).

### 1. Import: atomic and idempotent (H6, M14, L2)
`importFile` keeps its shape (parse JSON → check header → `migrate` each scan) and then calls a new
`importScans(scans)` in `db.ts` that does **all writes in one** `db.transaction('rw', db.scans, …)`:
- **Header:** `version` must be exactly `1` (M14). Other numbers → "This file is from a newer Specimen. Update
  Specimen and try again." (≥2) or "does not look like a Specimen export" (non-integer / < 1).
- **Per scan, before the transaction** (pure, can't half-write): `migrate(raw)`, then filter `cssVariables` through
  the extractor's own rule (L2). I export `designVars` (VAR_NAME, value ≤ 200 chars, ≤ 200 entries) from
  `packages/core/src/extract` as `filterCssVariables` and reuse it, so the live scan and the import share **one copy**
  of the rule (no drift). Rejected/skipped rows are counted as today.
- **Inside the transaction:** read the existing rows for the incoming ids (`bulkGet`), then for each scan:
  - same id **and same content** already stored (or earlier in the same file) → not written, counted as
    `duplicates` ("already in your Library"). Content = a stable (sorted-key) JSON of the scan without
    tags/favorite. This is what makes a retry, or importing the same file twice, a no-op.
  - same id, **different content** → new `crypto.randomUUID()` (today's "keep both copies" behaviour).
  - otherwise stored as is, `tags: []`.
  - Writes go through `bulkAdd` of `DesignScanSchema.parse`d rows (L3).
- Any failure inside (quota, `put` rejects, a parse error) aborts the transaction: **nothing is stored**, and
  `importFile` throws a readable error: "Import failed, nothing was saved: <reason>." with `QuotaExceededError` →
  "your browser is out of storage space". The raw Dexie text is never the whole message.
- `ImportResult` gains `duplicates`; the Library toast reads e.g. "Imported 3, 2 already in your Library, skipped 1".
- Max scans per file (sec M2's "cap scans per import file", e.g. 500): **part of the M2 ruling**, see §5.

### 2. A failed save after a scan is shown (H7)
- `scanTab` returns `saved: boolean` and `saveError?: string` (friendly text; quota / private mode / validation)
  instead of swallowing. The scan itself still succeeds, as today.
- Store: new `saveError: string | null` on the state, set by `succeed(..., saveError)`, cleared by `start`/`openScan`.
- `Scan.tsx` shows a warning line under the result: "Not saved to Library: <reason>. The scan works here, but it
  won't be in the Library after you close the panel." (`data-testid="save-error"`, `role="status"`).
- `Scan.tsx` "Add another page": `replaceStoredScan(merged).catch(() => {})` → the note says "2 pages merged (not
  saved to Library)" on failure.
- `extras.ts attach` (mobile / dark variant → `updateScan`) and `Vibe.tsx` (`updateScan(vibe)`) also swallow. I add
  the same "(not saved to Library)" suffix to `extras.note` for attach; Vibe stays as is (the vibe is regenerable and
  Vibe.tsx is SPC-27's lane next). **PE: OK to leave Vibe?**

### 3. Library card writes (M13)
`ScanCard.tsx` rename / tag / favourite / delete get try/catch → the Library's existing error line ("Could not save
that change: <reason>"), and the card re-reads so the UI doesn't show an edit that wasn't stored. Delete already runs in
a transaction.

### 4. db.ts writers (L3, M14 thumb)
Keep `DesignScanSchema.parse` in all four writers, store **the parsed value**:
- `saveScan`: `const clean = DesignScanSchema.parse(scan)`; blob decoded **before** the transaction (a bad data URL
  means "no thumbnail", not a failed save); then one `transaction('rw', scans, thumbs)` puts both, so a failed thumb
  write leaves neither row (M14).
- `replaceStoredScan`: parse, then read old tags/favorite and put **inside one transaction** (today a concurrent tag
  edit between the get and the put is lost).
- `saveCompose`: store the parsed value (already transactional).
- `updateScan`: every patch (not only `variants`) runs in the transaction: `clean = parse({ ...migrate(row),
  ...patch })`, store `{ ...clean, tags, favorite }`. That also validates titles once M2 bounds them. A row that no
  longer migrates → the update throws (today a non-variants patch silently writes onto an unreadable row).
- `loadChat`/`saveChat` keep `await chatsReady` untouched.

### 5. M2 bounds (CONTRACT: waits for the PE's final ruling + owner OK)
My proposal, matching the PE's draft (v5 bump, shared bounds table, trim on upgrade):
- `packages/core/src/schema/bounds.ts`: one `BOUNDS` table (single copy, imported by the schema, `migrate` and the
  extractor tests). Starting numbers from the sec review, well above real scans: palette ≤ 512 (each variant too),
  `cssVariables` ≤ 500 entries, key ≤ 200, value ≤ 500 chars; `title`/`url`/`host` ≤ 2000; `typography.styles` ≤ 200,
  `families` ≤ 50; `sample` ≤ 200; `meta.warnings` ≤ 100 (each ≤ 500); `meta.pages` ≤ 50; blueprint ≤ 200; other
  arrays (gradients, shadows, borders, breakpoints, scale, a11y pairs, components, keywords) ≤ 200; vibe summary ≤ 2000;
  scans per import file ≤ 500 (over → reject the file with a clear message, nothing stored).
- `DesignScanSchema` v5 = v4 + `.max()` everywhere above. `SCHEMA_VERSION`/`CURRENT` → 5. A v5 row over a bound is
  rejected (like v4's strict rules).
- `migrate` v1–v4 → v5: `repairColors` (v1–v3 only) then `trimToBounds`: truncate strings, slice arrays (palette by
  existing order, which is weight order), then drop roles that now dangle; add one warning "Trimmed on upgrade: …".
  Idempotent, input not mutated.
- Fixtures: every `*.expected.json`, merge, compose and derived variant must pass v5 with no trim (T1.01 loop).
- Stored v4 rows upgrade on read through `migrate` (no Dexie version bump needed; rows are rewritten only on the
  next write).

### 6. L1
`repairColors` clones only `colors`, `variants.dark`, `variants.light` and `meta.warnings` (shallow copies of the
parents it touches), not the whole input. Output identical to today for valid input (existing T1.01 tests).

### Failure modes
- **Atomicity:** import is one transaction; saveScan scan+thumb is one transaction; any throw inside rolls back.
  Validation runs before the transaction, so a bad row can't abort half a file (it's skipped and counted).
- **Idempotency:** a retry after a failed import stores exactly what one clean import would; a second import of the
  same file stores nothing new (duplicates counted). In-file duplicate ids: identical → one row; different → new id.
- **Partial failure:** a quota error mid-import → zero rows and a readable message; a scan whose save fails → the scan
  still shows, plus the "Not saved" line; a thumb that can't be decoded → scan saved without a thumb.
- **Errors during cleanup:** no cleanup step exists outside the transaction (Dexie aborts it); the UI error path is a
  plain state set, which can't throw.
- **Concurrency:** two imports at once, or an import racing a scan save: each is its own IDB `rw` transaction on
  `scans`, so they serialise; the existing-id check runs inside the transaction, so two imports of the same file
  can't both write the same scans. `replaceStoredScan` and `updateScan` read-modify-write inside a transaction.
- **Drift between two copies of a fact:** the cssVariables rule lives once (`filterCssVariables` in core) and the
  bounds live once (`BOUNDS`). The import's "same content" check compares parsed values, so key order can't fake a
  difference.
- **Misleading success:** the toast only claims what was written; the scan view says when the Library save failed.

### Tests (tests first for core; extension unit tests with fake-indexeddb)
- **T4.03** `db.scans.bulkAdd` (or the 2nd write) stubbed to reject → `importFile` rejects with "nothing was
  saved", `db.scans.count()` unchanged; then the stub is removed and the **same file is re-imported** → exactly N rows,
  no duplicates; a third import → `{ imported: 0, duplicates: N }` and still N rows.
- **T4.03** quota: the write rejects with a `QuotaExceededError` → message names storage space, zero rows.
- **T4.03** `version: 2` rejected ("newer Specimen"), `version: 0`/`"1"` rejected; in-file duplicates: identical
  twice → 1 row; same id different content → 2 rows, distinct ids.
- **T4.03** L2: an imported scan with `cssVariables` `{ constructor: 'x', '--brand': 'ok', '--color-x': '`'.repeat(300) }`
  keeps only `--brand`.
- **T4.02** existing "keeps both copies" test changes to: same id + different content → both kept; same content → one.
- **T4.01** saveScan with the thumbs `put` rejecting → neither row exists; a broken data URL → scan saved, no thumb.
- **T4.01** L3: `saveScan`/`replaceStoredScan`/`saveCompose`/`updateScan` with an extra unknown key → the stored row
  has no such key; `updateScan` with a bad patch rejects and leaves the row unchanged (existing test kept).
- **T4.08 (unit)** new `test/scanSave.test.tsx`: `send` stubbed to return a RawPage, `db.scans.put` rejecting →
  `scanTab` resolves with `saved: false`; `runTabScan` → store `status: 'done'` and `saveError` set; Scan view renders
  "Not saved to Library". Happy path: `saved: true`, no line.
- **M13** (C test, Library): `updateScan` rejecting on rename → error text shown, title unchanged.
- **T1.01** L1: a v3 input with a 100k-deep junk key migrates (no `RangeError`) and the junk key is gone; input not
  mutated (existing assertion).
- **M2 (after OK), T1.01:** a v5 scan over each bound is rejected; a v4 scan with 150k palette entries / 100k vars /
  a 30k title migrates to v5 trimmed with one warning, roles still valid, idempotent; all fixtures pass v5 untrimmed;
  T4.03: an import file with 501 scans is rejected and stores nothing.
- New rows/edits in `docs/TESTING.md` for T4.01/T4.03/T4.08 wording.

### Order of work
1. L1, L3, M14, H6, L2, H7, M13 (no contract), gate green, commit.
2. M2 after the ruling + owner OK, as its own commit(s) in the same PR (or a follow-up PR if the owner prefers).

### Questions for the PE
1. OK that a same-id **same-content** import is skipped as a duplicate (changes the T4.02 "keeps both copies" test
   for identical content)?
2. Vibe.tsx's silent `updateScan` left as is (SPC-27 lane), or fold it in?
3. M2: final bounds numbers, whether over-bound v5 rows are rejected or trimmed, and the per-file scan cap.
4. Touching `ScanCard.tsx`, `extras.ts` and `Scan.tsx` (not in lane C's "Owns" list, but no active lane holds them).

## Done
- Commit 1 (non-contract): `importScans` (one transaction, duplicates skipped, a clashing id gets a content-derived
  id `<id>-<12 hex>` so a retry finds it: a deviation from the plan's random UUID, needed for idempotency), version 1
  only, `filterCssVariables` exported from core and applied on import, saveScan scan+thumb in one transaction, every
  writer stores the parsed value, `updateScan` validates every patch, `scanTab.saveError` + store `saveError` +
  "Not saved to Library" line, merged-page and capture notes, ScanCard errors, `libraryErrorText`, L1.
- Commit 2 (M2, v5): `schema/bounds.ts` (`BOUNDS`, `str`/`list`/`dict` helpers registering each bound in `MAX`),
  `schema/trim.ts` (`trimToBounds` walks the zod schema, so trim and checks can't drift; `clampToBounds` for
  producers), migrate v1–v4 → v5, extract/merge/compose clamp, 500-scan file cap, derived import id kept ≤ 1000.
  Hex is deliberately not trimmed (a long hex must be rejected, not cut into a valid one).
- `pnpm gate` green locally (gitleaks not installed here; CI scans).

## Next
- Reviews (PE lens A, lens B, security). Fold findings as new commits.
- Follow-ups not in this PR: Vibe.tsx silent save (PE filing); caching migrated rows in `listScans`; Library
  rescan (`rescanUrl`) ignores `saveError`.

## How to resume
Read this file, then SPC-19 in Linear with comments. Worktree `specimen-herdr/worktrees/spc-19`, branch `exec/spc-19`.
