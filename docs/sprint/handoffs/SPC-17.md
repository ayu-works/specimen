# SPC-17 handoff: brand leak via camelCase CSS vars (H3) + migrate() integrity (H4), plus M15, M16

Executor session `spc-17-13`, branch `exec/spc-17`, lane A. Status: **Built; `pnpm gate` green; PR open, awaiting reviews.** PE approved 2026-10-15 (pe-99, 3 changes folded in); the owner OK'd the v4 contract 2026-10-15 (relayed by specimen-53).

## Plan

### Part 1: guardrail (H3, M15, M16). No contract change.
Root cause: `sanitize.ts` `wordRegex` uses `(?<![\p{L}\p{N}])tok(?![\p{L}\p{N}])` with flag `iu`, so `zentrix` inside
`--zentrixBlue` has no boundary. `containsBrand` also lowercases its input first, which destroys the case hump.
`designmd.ts:296-298` already filters CSS vars with `containsBrand`, so the leak is entirely this boundary.

Fix in `packages/core/src/generate/sanitize.ts`:
- `wordRegex(tok)` becomes camelCase-aware. It can't use the `i` flag, because under `/iu` `\p{Lu}` also matches
  lowercase letters (checked in node: `/\p{Lu}/iu.test('a') === true`). So the token body is spelled
  case-insensitively per character (`[zZ][eE]…`, with plain escaping when a char has no single-char upper form) and the
  flag is `gu`. Boundaries:
  - left: not after a letter or digit, **or** a hump (after `\p{Ll}` with the match starting `\p{Lu}`), **or** a
    digit-to-letter change;
  - right: not before a letter or digit, **or** a hump (last char `\p{Ll}`/`\p{N}` with next `\p{Lu}`;
    `ZENTRIXBlue`: last `\p{Lu}`, next `\p{Lu}\p{Ll}`), **or** a letter-to-digit change (`zentrix500`); the
    `(?!-gradient)` exclusion stays.
  - Ordinary words keep working: `Calendar` with token `cal` has no hump (`l`→`e`), so it isn't touched.
- `containsBrand` tests the original text (no `toLowerCase()`), so humps survive.
- `designmd.ts` CSS-variable filter: a **name** is dropped when it contains a brand token **of 4+ characters** as a
  plain substring (`--zentrixblue`, all lowercase, has no boundary at all). Tokens of 2–3 characters (`hp.com` → `hp`)
  use the hump/word rule only, so `--php-version` survives (PE change 1). Dropping a row from a 40-row table is harmless. Values
  keep the word match (a value like `#123` must not be dropped by accident).

Callers that inherit the fix: `sanitize()` (prompt, DESIGN.md, fixPrompt, and `packages/ai` `collect.ts`, which the
council uses on every turn, SPC-24) and `fontInfo` (`containsBrand`).

### Part 2: schema integrity (H4). **CONTRACT CHANGE, needs PE approval and then the owner's OK.**
Proposed `DesignScan` change, `schemaVersion` 3 → **4**. The TS shape is unchanged; only validation tightens:
```ts
// scan.ts
export const HexSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'expected #rrggbb');
ColorTokenSchema.hex: HexSchema            // was z.string(); also applies to variants.{dark,light}.palette
DesignScanSchema = z.object({ schemaVersion: z.literal(4), ... }).superRefine(rolesPointAtPalette)
// rolesPointAtPalette: every colors.roles[r] is an id in colors.palette; for each variants.{dark,light},
// every roles[r] is an id in (variant.palette ?? colors.palette), the same lookup roleColors() uses.
// index.ts: SCHEMA_VERSION = 4
```
Why `#rrggbb` lowercase only: the extractor writes `toHex({...rep, alpha: 1})` (culori `formatHex`, always 6-digit
lowercase), and derived variants use `fromOklch` (same). Alpha lives in its own field. The refine goes on the top-level
object, not `ColorsSchema`, because `ThemeVariantSchema` calls `.partial().extend()` on it.

Migration (`migrations.ts`), so old saved scans and imports keep working:
- **v1/v2/v3 → v4: repair, then strict parse.** For `colors.palette` and each variant palette: a token whose `hex`
  isn't `#rrggbb` is normalised when culori can parse it (`#ABC`, `#AABBCC`, `rgb(…)` → `toHex(…, alpha 1)`, and
  `oklch` is recomputed); otherwise the token is **dropped**. Then any role whose id is no longer in its palette is
  **dropped** (the generators already treat a missing role as absent). When the repair changed anything, one line
  goes into `meta.warnings` (`"Repaired on upgrade: dropped 1 color, 1 role"`). The warning is informational and
  **per read**: `toStored` doesn't write back, so it shows on every read of that v3 row until the scan is re-saved
  (the re-saved row is v4 and carries it once; it never stacks, which the idempotency test covers) (PE change 3). Rows that still fail (missing fields,
  etc.) throw as today.
- **v4 input: strict, no repair.** A v4 row was written by a build that guarantees the rules, so a violation means a
  hand-edited or corrupt file: `migrate()` throws, `importFile` counts it as skipped, and `listScans` skips it (the
  existing `toStored` try/catch).
- Newer than v4 still throws "Unsupported scan version".
- The repair is pure and idempotent (repairing a repaired row changes nothing, adds no second warning) and never
  mutates its input (it works on a structured clone).

Also: the `schemaVersion: 3` literals in `compose/index.ts:99`, `extract/index.ts:84` and `extract/merge.ts:283` become
`SCHEMA_VERSION`; `sampleScan.ts`, `test/fixtures/minimal-scan.json`, `library.test.ts:115` and ARCHITECTURE.md
(§ schema, line 114, plus the migrations paragraph at line 157) are updated to v4.

**Alternative, if the owner prefers no bump:** keep v3 and do the repair for every row with no tightening of
`DesignScanSchema`. It's smaller, but the schema then doesn't state the guarantee the generators rely on, and the
ticket's "migrate() rejects" check would become "migrate() repairs". I recommend the v4 bump.

### Files
`packages/core/src/generate/{sanitize.ts,designmd.ts}`, `packages/core/src/schema/{scan.ts,migrations.ts,index.ts}`,
`packages/core/src/{compose/index.ts,extract/index.ts,extract/merge.ts}`, core tests, `apps/extension` (`sampleScan.ts`,
`test/library.test.ts`), `docs/TESTING.md` (rows T1.01, T2.03, T4.03 widened, no new IDs), `docs/ARCHITECTURE.md`.

### Tests (written first; ★ = fails on today's `main`)
- ★ **T2.03** `generateDesignMd` on a scan at `zentrix.com` with `cssVariables` `--zentrixBlue`, `--brandZentrix`,
  `--zentrixblue`, `--ZENTRIX_RED`, `--zentrix500`, plus a value `var(--zentrixBlue)`: the output has no `zentrix` in
  any case, and an unrelated var (`--space-4`) is still listed.
- ★ **T2.03** `sanitize` unit cases: `zentrixBlue`, `myZentrix`, `ZENTRIXBlue`, `zentrix500` are stripped;
  `Calendar` with token `cal` and `linear-gradient` are left alone.
- **T2.03 (M15)** a table of host forms `app.zentrix.io`, `WWW.ZENTRIX.COM`, `shop.zentrix.co.uk`, `zentrix.dev:8080`
  and a title-only brand (`title: "Zentrix — …"` on an unrelated host). Prompt (every target) and DESIGN.md contain no
  `zentrix`. Checked with a substring search, not the word regex, so a test can't share the bug it checks.
- **T2.03 (M16)** a family named `Zentrix Grotesk`: `fontInfo` gives `branded: true`, the label "the source's custom
  display face", and an alternative; the prompt contains neither `Zentrix` nor `Grotesk`'s full family name.
- ★ **T1.01** v4 input: `DesignScanSchema` and `migrate()` reject `hex: 'zzz'`, `hex: '#ABC'`, a role id not in the
  palette, and a variant role that points nowhere.
- ★ **T1.01** v3 input: a bad-but-parseable hex is normalised (and `oklch` recomputed), an unparseable token is dropped
  together with the role that pointed at it, a warning is added, and `generatePrompt`/`generateDesignMd` then run
  without throwing. Idempotent: `migrate(migrate(x))` deep-equals `migrate(x)`. The input object is unchanged.
  The clean v1/v2/v3 fixtures upgrade with no warning.
- ★ **T4.03** `importFile` with one clean scan, one v4 scan with `hex: 'zzz'` and one v4 scan with a dangling role:
  `{imported: 1, skipped: 2}`, and the bad ones aren't stored. A v3 scan with a bad hex is imported repaired.
- **T1.01 (PE change 2)** real-data proof that v4 drops no extractor output: `extract` over every
  `fixtures/raw/*.json` capture and every `fixtures/pages` page, plus a compose/merge result and a derived dark variant,
  then `DesignScanSchema.parse` (v4) on each: all pass with no repair warning.
- **T2.03 (PE change 1)** host `hp.com` keeps `--php-version` and drops `--hpBlue` in DESIGN.md.
- **T4.01** a stored v3 row with a bad hex still lists (repaired), and Generate on it doesn't throw.
- Council check: `packages/ai` `critique.test.ts` and `features.test.ts` stay green unchanged.

### Failure modes
- **Over-stripping prose** (the camelCase boundary removes too much): covered by the `Calendar` / `linear-gradient`
  cases and the existing T2.03 fixture run, plus the snapshot tests. A new hump boundary only fires at a case or digit
  change, and those are rare in prose.
- **Drift between two copies of a fact:** the `schemaVersion` literal appears in five places today. All read
  `SCHEMA_VERSION`, and T1.01 already asserts the fixture matches it.
- **Idempotency:** repair runs on every Library read (`toStored`), so it must be stable and pure. Tested.
- **Partial failure in import:** each row is migrated alone, so a bad row is skipped and the rest still import (the
  existing loop). Tested with a mixed file.
- **Old data vanishing:** a v3 row is repaired rather than rejected, so saved scans keep listing. Only a hand-broken v4
  row is skipped, the same path a v99 row takes today.
- **Atomicity / concurrency / cleanup:** n/a. `migrate` is pure, and the db read path doesn't write back.
- **Compose / extract output** must satisfy v4: covered by the existing extract and compose tests, which parse their
  output through the schema (I'll add a `DesignScanSchema.parse` on a compose result if none exists).

### Check
`pnpm gate` green.

## Done
- Plan written (2026-10-15). PE approved with 3 changes, folded in (2026-10-15).

- Part 1 built (commit fd91661): `packages/core/test/guardrail.test.ts` (5 tests, 4 failed on main first); fix in
  `sanitize.ts` (`wordRegex` case-sensitive humps, `containsBrand` keeps case, new `nameHasBrand`) and `designmd.ts`.
  Core 62/62 with snapshots unchanged; `packages/ai` 158/158 (council tests green).

- Part 2 built (owner OK 2026-10-15): tests first in `packages/core/test/schema.test.ts` (T1.01 strict v4, repair,
  clean upgrade, real-data proof) and `apps/extension/test/library.test.ts` (T4.01 stored v3 row, T4.03 mixed import);
  `HexSchema` + `danglingRoles` + `superRefine` in `scan.ts`; `repairColors` in `migrations.ts`; `SCHEMA_VERSION` 4 used
  by extract/merge/compose/sampleScan. The real-data proof passed on main too (it's a guard, as intended); the other
  new T1.01 tests failed on main first. TESTING.md rows T1.01/T2.03/T4.01/T4.03 widened (no new IDs);
  ARCHITECTURE.md §4.2 says v4. `pnpm gate` green: core 66, ai 158, extension 85, e2e 51.

- PR #29 opened 2026-10-15; CI `gate` green on 79ab376. Lens A + contract r1 (pe-99): APPROVED, 0 findings
  (`docs/sprint/reviews/SPC-17-a-r1.md`); its condition (CI green) is met.

## Next
- Still to come: lens B and security reviews. Remaining reviews: PE lens A, a fresh lens B, plus security (per plan.md). Fold the findings in as new commits.

## How to resume
Read this file, then `git log origin/main..exec/spc-17`. Part 1 can be built once the PE approves; Part 2 waits for
the owner's OK.
