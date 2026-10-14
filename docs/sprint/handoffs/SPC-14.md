# SPC-14 handoff: check-ids covers phases 0–7; dropped MCP IDs

Executor: spc-14-6b · Branch: exec/spc-14 · Lane A · Label: contract

## Plan (PE approved 2026-10-14 with changes 1–4 below; owner OK'd the ⊘ format 2026-10-15)

### State today (origin/main at bbc8854)
- `--all` uses a hard-coded `BUILT_PHASES = {0..5}`, so phases 6–7 are never gated.
- `pnpm check-ids --phase 7` passes (T7.01–T7.04 present). `--phase 6` fails on T6.01–T6.04 (MCP, dropped 2026-10-09;
  IMPLEMENTATION.md Phase 6). T6.05 is 🖐, so it is already skipped, but it is still "planned" in the doc.
- The parser keys on the ID cell (`| T6.01 |`) and treats a row as manual if any cell after it is exactly `🖐`.

### Contract: the TESTING.md "dropped" format (needs PE approval, then owner OK)
A dropped test keeps its row and ID (IDs are never reused). Its **Type cell is exactly `⊘`** and its Test cell starts
with `**Dropped YYYY-MM-DD**` and a reason/pointer, with the original text struck through:

```md
| T6.01 | ⊘ | **Dropped 2026-10-09** (MCP bridge cut from v1; IMPLEMENTATION.md Phase 6, SPC-10): ~~MCP server exposes …~~ |
| T6.05 | ⊘ | **Dropped 2026-10-09** (MCP bridge cut from v1; IMPLEMENTATION.md Phase 6, SPC-10): ~~`claude mcp add specimen …`~~ |
```
plus a legend entry in the "Types:" line: `· **⊘** = dropped (kept for the record; the ID is never reused or checked)`.

Why `⊘` in the Type cell: it matches how `🖐` already works (a single-symbol Type), so the parser rule is one more
exact-cell match, and the ID cell stays plain so the existing row regex is unchanged. Rule for the checker: a row is
**dropped** iff a cell after the ID is exactly `⊘` (same rule as `🖐`). A row can't be both; if it is, the checker errors.
The Phase 6 heading stays `## Phase 6: MCP & release` (the checker keys on `## Phase <n>`; no rename needed).

T7.02 (Sprint plan override comment on SPC-14): the row text becomes
`Lighthouse ≥ 95 (…) via @lhci/cli — **CI report, non-blocking** (lighthouse.yml): check-ids presence = the report-logic tests exist, not that ≥ 95 passed`.

### Checker changes (`scripts/check-test-ids.ts`)
Refactor into exported pure functions, `main` guarded by `process.argv[1] === fileURLToPath(import.meta.url)` (as in
`secret-scan.ts`):
- `parseIds(md, wanted: (phase) => boolean)` → `Map<id, {phase, kind: 'auto' | 'manual' | 'dropped'}>`; throws on a
  duplicate ID or a row marked both `🖐` and `⊘`.
- `missingIds(required, sources)` → the IDs with no `'T<id> ` / `"T<id>:`-style test name (existing regex).
- `--all` = phases **0–7** (`ALL_PHASES`, explicit list, replacing `BUILT_PHASES`). It fails if any of 0–7 has no
  `## Phase <n>` heading or zero rows (guards against a heading rename silently dropping a phase).
- Dropped IDs are never counted as present: output is
  `check-ids: all N phases 0-7 test IDs present (…); dropped: T6.01, …; manual: …` — dropped are listed separately.
- A dropped ID that **does** appear as a test name fails (`dropped but still tested: T6.0x`): drift between the doc and
  the code. (Today no T6.01–T6.04 test exists on main; the `phase-6-mcp` branch isn't scanned.)
- `--phase <n>` keeps working; a phase whose rows are all dropped/manual still errors "No test IDs found" only if it
  has zero rows at all (phase 6 still has T6.07 so it passes).
- Usage comment updated.

### Tests (`scripts/check-test-ids.test.ts`, node:test via `pnpm test:scripts`, already globbed)
Fixture markdown strings, no fs:
- Test names describe behaviour (the checker has no TESTING.md ID of its own).
- dropped ID is skipped: a `⊘` row is not required, and is reported as dropped, not present.
- missing non-dropped ID fails: an `U` row with no matching source → in `missingIds`.
- dropped ID that is still tested → reported as drift (fails).
- phases 6–7 included in `--all`; a missing `## Phase 7` heading fails `--all`.
- duplicate ID / `🖐`+`⊘` on one row → throws.
- 🖐 rows still skipped (regression).
Plus the real run: `pnpm check-ids --all` on the branch lists 0–7 and passes; and a scratch edit deleting one T7 test
name makes it fail (done by hand, not committed; reported in the PR).

### Files
`scripts/check-test-ids.ts`, `scripts/check-test-ids.test.ts` (new), `docs/TESTING.md` (Types legend, T6.01–T6.05
rows, T7.02 row), this handoff. All lane A.

### Failure modes
- Drift between two copies of a fact: IMPLEMENTATION.md says "dropped" in prose, TESTING.md in the table. The table is
  the one the gate reads; I won't edit IMPLEMENTATION.md (lane B). The "dropped but still tested" error covers
  doc-vs-code drift.
- Silent skip: a typo in the marker (e.g. `⊗`) makes the row "auto" → it fails as missing, i.e. fails loud, not silent.
- Phase rename/removal → `--all` errors on a missing phase rather than shrinking coverage.
- Atomicity/concurrency/cleanup: N/A (read-only script; no writes, no processes).
- Gate: `pnpm gate` must be green; it ends with `pnpm check-ids --all`, which now includes 6–7.

## Done
- Read brief, setup, plan, SPC-14 + override comment; `pnpm i`.
- Plan written (above) and sent to pe-5e on 2026-10-14.
- PE (pe-5e) APPROVED plan + `⊘` format on 2026-10-14 (received just after the pause), with required changes:
  1. Fixture IDs must be fake (T98.xx / T99.xx): check-ids scans scripts/check-test-ids.test.ts too, so real IDs in
     fixture strings would count as present / as "dropped but still tested". Add an assertion that the real
     TESTING.md has no Phase 98/99.
  2. `--all` = every `## Phase <n>` heading in TESTING.md, AND assert 0–7 are all present (no hard-coded list that
     would leave a future Phase 8 ungated).
  3. Self-checking format: `⊘` row whose Test cell doesn't start with `**Dropped YYYY-MM-DD**` → error; a "Dropped"
     prefix without `⊘` → error. Legend says `⊘` only goes in a Type cell (add a Type column first; no ad-hoc cell).
  4. Print the required count per phase; a phase whose rows are all dropped/manual passes with "0 required" stated.

- Paused 2026-10-14 by the owner; resumed 2026-10-15 (orchestrator now `specimen-af`).
- Built with PE changes 1–4: fixtures use T98/T99 + an assertion that the real TESTING.md has no Phase 98/99; `--all`
  = every `## Phase <n>` heading, plus REQUIRED_PHASES 0–7 must exist; the ⊘ format is self-checking (prefix, date,
  Type cell only, no "Dropped" without ⊘, no 🖐+⊘, no duplicate ID); per-phase "N required" lines.
- TESTING.md: legend gains ⊘; T6.01–T6.05 → ⊘ rows; T7.02 says "CI report, non-blocking; presence ≠ ≥ 95 passed".
- Verified: `pnpm test:scripts` 21/21 (11 new); `pnpm check-ids --all` → 92 IDs, phases 0–7 (6: 1 required, 7: 4),
  dropped T6.01–T6.05; `pnpm gate` exit 0 (secrets SKIPPED locally: no gitleaks; CI scans).
- Red proofs (scratch edits, reverted): renaming T7.01 in site.spec.ts → "Missing tests … T7.01", exit 1;
  turning T6.01 back into a `U` row → "Missing tests … T6.01".

## Next
- PR review (PE lens A, lens B, contract). Fold findings as new commits.

## How to resume
Worktree /Users/ayushmayank/Claude coding/Projects/Specimen-wt/spc-14, branch exec/spc-14. Read this file and any
`docs/sprint/reviews/SPC-14-*`; message specimen-af / pe-5e.
