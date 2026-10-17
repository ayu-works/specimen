# SPC-19 lens A + contract r1 (PE pe-ed, 2026-10-17): PR #33 at c1e4917

**Verdict: APPROVED. 0 CRITICAL, 0 HIGH, 0 MEDIUM, 3 LOW** (all optional). CI is green and the PR is CLEAN.

## Contract (DesignScan v5, against `reviews/SPC-19-m2-ruling.md` on pe/sprint-2): conforms
- `SCHEMA_VERSION = 5` and `CURRENT = 5`. `BOUNDS` is the one table, and the schema nodes are built through
  `str`/`list`/`dict`, which register their bound in `MAX`, so `trimToBounds` reads the very numbers zod checks.
  T1.01 walks the schema and fails on any unbounded string, array or record (only the hex pattern is exempt).
- v1–v4 → v5 trims with one warning; v5 over a bound is rejected (T1.01 :342); the hostile v4 row (150k palette,
  100k vars, 30k title) upgrades with valid roles (T1.01 :363).
- Producers: `extract` (including `validate:false`), `mergeScans` and `compose` clamp without a warning. T1.01
  :185 shows real extractor output, a merge, a compose and a derived variant need no trim.
- **Two deviations, both accepted:**
  1. The ruling said trim, then `repairColors`. The PR repairs first, then trims, and `dropCutRoles` removes
     exactly the roles whose palette ids the trim cut (base and variants, with the base fallback). The result is
     the same.
  2. On an id clash, the new id is derived from the content: `<id>-<sha256/48 bits>`, kept inside the id bound.
     This is better than a random UUID, because a retry or a re-import then finds the row instead of adding a copy.

## Correctness checks
- **Import atomicity.** `importScans` parses and hashes (`crypto.subtle`) *before* the transaction. Inside it
  there are only Dexie awaits plus the synchronous `migrate`, and one `bulkAdd` runs whose rejection aborts the
  transaction. T4.03 fails the 2nd create through a real Dexie hook on fake-indexeddb and gets 0 rows. That test
  fails on main, which wrote scans one by one.
- **Idempotency.** A same id with the same content → `duplicates`. An in-file repeat is caught through `taken`.
  An unreadable stored row keeps its id, with content `null`, so it is never overwritten.
- **Writers store the parsed value (L3).**
  - `saveScan` decodes the thumbnail outside the transaction and writes scan + thumb together.
  - `replaceStoredScan` and `updateScan` read and write inside one transaction.
  - `updateScan` validates every patch and keeps tags/favourite.
  - A v4 row is rewritten as v5 on its first edit. That is idempotent, because a second edit adds no second
    warning.
- **Misleading success removed.** `scanTab` returns `saveError`. The extras attach and the Library card show the
  reason, and the card reloads, so an unsaved edit isn't left on screen. Vibe.tsx is SPC-33.
- **L1.** `repairColors` makes shallow copies of only what it changes, and the deep junk key test passes.
- **L2.** The import applies the shared `filterCssVariables`; one copy of the rule is exported from `extract`.
- `chatsReady` and every `DesignScanSchema.parse` in the writers are kept.

## LOW

### L1. Re-importing a file imported before this PR can add one copy, when its CSS variables carry names the filter drops
`importFile` now filters `cssVariables` before comparing. A row imported by the old code kept the unfiltered
variables, so the content keys differ, and the scan is stored again under `<id>-<hash>`. This happens once only,
and only for hand-made or old exports with non-design variable names. **Fix (optional):** compare
`contentKey({...migrate(row), cssVariables: filterCssVariables(row.cssVariables)})` on the stored side.

### L2. Renaming a scan to more than 1000 characters says "the scan didn't pass validation"
The rename is correctly refused (v5 `title ≤ 1000`), but the message doesn't say why. **Fix (optional):** set
`maxLength={BOUNDS.title}` on the title input.

### L3. `libraryErrorText` falls back to the raw `err.message`
For an unknown error, the user sees Dexie's text after "Import failed, nothing was saved:". It is not a
secret, but it is not plain language either. **Fix (optional):** use a generic "browser storage failed" and
keep the detail out of the UI.

## Fold check (0851801, on top of c1e4917): APPROVED
- **L1 fixed.** The stored side is compared through the same `filterCssVariables`. The filter is idempotent, so a
  live-scanned row is unchanged by it. A new T4.03 test pins that an old unfiltered row counts as a duplicate.
- **L2 fixed.** The title input has `maxLength={BOUNDS.title}`.
- **L3 declined.** The reason is accepted: the text is not a secret, and it is the only clue for an unknown
  failure. `trim.ts` and `migrations.ts` are unchanged.

## Lens-B fold check: ad19fe6 (pe-8a, 2026-10-17): APPROVED, 2 optional LOWs
Checked `git diff 0851801..ad19fe6` for `db.ts`, `schema/trim.ts` and `schema/index.ts`. `migrations.ts` and
`bounds.ts` are unchanged.
- **trim `cutText`:** correct. It cuts to `max - 1` when unit `max - 1` is a high surrogate, so a pair is never split.
  The walk uses it, so v1–v4 trimming is unchanged except at that edge.
- **M2 re-key:** correct. `toStored` keeps the stored key, so the panel can address the row. `findRow` falls back to
  the cut id only for ids over the bound. `putReplacing` runs inside one rw transaction over scans, thumbs and chats,
  so a failed put or delete rolls back the move. `chatsReady` is awaited outside the transaction, as it must be.
- **M1:** the stored-side compare now filters with `BOUNDS.cssVariables`, the same as the import, so the 400-var
  backup is no longer mis-keyed. **L2:** BulkError `failures[0]` is read.
- **Can the tests fail?** I ran ad19fe6's `test/library.test.ts` with `db.ts` reverted to 0851801: 5 failed (T4.01 ×3,
  T4.02, T4.03) and 26 passed.

**L-a (optional). The export can carry an over-bound id.** `toStored` returns the 1500-char key as `id`, with
`schemaVersion` 5, and `buildExport` writes it as is. Re-importing that file runs strict v5 validation, so the scan
is skipped: an export → import round trip loses a row that was never edited. Fix: in `buildExport`,
`id: cutText(s.id, BOUNDS.text)`.

**L-b (optional). A re-key can overwrite another scan.** `putReplacing` puts at the cut id without checking for an
existing row. Two over-long v4 ids that share their first 1000 chars, or a v5 row whose id equals the cut, collide,
and the other scan, with its thumbnail and chat, is silently replaced. Both cases need a crafted import. Fix: if
`row.id !== key` and `db.scans.get(row.id)` exists, keep the row under its old key (do not re-key), or derive the
id from the content as the import does (`<cut>-<sha48>`).
