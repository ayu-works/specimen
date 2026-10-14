# SPC-14 lens A + contract review, round 1 (PE, 2026-10-15)

PR #23, commit 9e51acb. Scope: `scripts/check-test-ids.ts`, `scripts/check-test-ids.test.ts`, `docs/TESTING.md`.

**Result: 0 CRITICAL · 0 HIGH · 0 MEDIUM · 2 LOW. Lens A + contract approve.**

## Contract: does TESTING.md match the owner-approved format? Yes.
The owner OK'd the format (Linear SPC-14, 2026-10-15). It has four parts:
- **Row and ID kept.** T6.01–T6.05 keep their rows and IDs.
- **Type cell.** It's exactly `⊘`.
- **Test cell.** It starts with `**Dropped 2026-10-09** (MCP bridge cut from v1; see IMPLEMENTATION.md Phase 6, SPC-10)`,
  followed by the struck-through original text.
- **Legend.** The Types line explains `⊘`: the row and ID stay, IDs are never reused, check-ids skips the row and fails
  if a test still carries the ID, and `⊘` goes only in a Type cell.

T6.05, formerly 🖐, is now `⊘`. That's correct: a dropped manual check is dropped, not manual. The T7.02 row carries
the override wording ("a CI report, non-blocking … does **not** mean ≥ 95 passed").

## Checked and fine
- **The real run passes.** I ran `pnpm check-ids --all` in the worktree: phases 0–7, 92 required IDs present. It prints
  the required count per phase (phase 6: 1, phase 7: 4), T6.01–T6.05 as dropped and 10 manual IDs, with none dropped
  silently.
- **My plan changes are all in:**
  1. The fixture IDs are T98/T99, built at runtime (`it('${id} …')` inside a template), so the repo-wide scan can't
     read them as real tests. One test asserts the real TESTING.md has no Phase 98 or 99.
  2. `--all` covers every `## Phase <n>` heading, and fails when any of 0–7 is missing. A phase heading with no rows
     fails too.
  3. The `⊘` and "**Dropped date**" markers must appear together, so a row with only one of them fails. 🖐 or ⊘ in
     the Test cell, 🖐 with ⊘, and duplicate IDs all throw, and a parse error becomes a failed check, never a pass.
  4. A phase with only dropped or manual rows passes, and states "0 required".
- **Leaving a phase.** Any non-phase `##` heading (e.g. "Fixtures to build") ends the current phase, so rows below it
  aren't attributed to a phase. `###` headings don't match.
- **Drift check.** A dropped ID that still has a test fails, and so does a missing auto ID. Both use the same match
  rule as the existing check.

## LOW

**L1. The "reason" part of the contract isn't enforced.** `DROPPED_PREFIX` checks only `**Dropped YYYY-MM-DD**`, so
`| T6.01 | ⊘ | **Dropped 2026-10-09** ~~…~~ |` passes with no reason or pointer. *Fix:* require a parenthesised
reason after the date (`/^\*\*Dropped \d{4}-\d{2}-\d{2}\*\* \([^)]+\)/`), plus a fixture row for the failure.

**L2. A row's ID isn't checked against its heading.** A `T5.11` row placed under `## Phase 6` is counted as phase 6.
That's harmless for `--all`, because the ID is still required, but `--phase 5` would miss it. *Fix (optional):* throw
when the ID's phase number differs from the heading.
