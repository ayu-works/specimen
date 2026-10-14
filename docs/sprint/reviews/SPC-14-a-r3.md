# SPC-14 lens A + contract review, round 3 (PE, 2026-10-15)

Commit d5aef8a (lens-B r1 folds), reviewed as the diff from a707323.

**Result: 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW. Lens A + contract still approve.**

- **The contract is unchanged.** The `⊘` format and the T6.01–T6.05 rows are untouched. The TESTING.md edits are
  wording only: the legend says a new phase's table lands with its first tests, and the T7.04 row says it runs only in
  the `video` CI job. Neither needs a new owner OK.
- **Malformed rows (H1).** A table line whose first cell mentions an ID but isn't `| T<n>.<nn> | … |` throws. Rows
  before the first `## Phase` heading (the `it('T1.09 …')` example) are skipped before that check runs, so the example
  can't trip it.
- **Outside-gate and report-only (H2).**
  - T7.04, which is tested only under `apps/video/`, passes but is listed "outside pnpm gate". That matches the owner's
    decision and the T7.04 row's text.
  - "report-only" is derived from the row's "non-blocking" wording, not from a hard-coded ID.
- **Stricter test match (M1).** Only `it(` / `test(` / `<x>Test(` (plus `.only` / `.concurrent`) count; the `\s*`
  covers a newline after `(`, and template literals are matched. `describe` groups, comments and Error strings no
  longer count. A required ID with only `.skip` / `.todo` / `.fixme` fails, and a dropped ID found in any form,
  including skipped, counts as drift. `check-ids --all` is still 92, so no real test relied on the old loose match.
  - Note for later: `it.each([...])('T…')` would not match. No test uses it today, and if one ever does, it fails loud
    as "missing", never silently.
- **Strict arguments (M2).** `parseArgs` replaces the phase-0 default with exit 2 on an unknown, missing or
  conflicting argument.
- **Which files are scanned (L2).** `git ls-files -co --exclude-standard` lists the test files. Git's default pathspec
  `*` crosses `/`, so nested files match, and ignored outputs and `.claude/` drop out. Outside a git checkout it throws,
  which fails loud.
