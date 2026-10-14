# SPC-14 review, lens B (real-world failures), round 1

Reviewer: fresh lens-B session, 2026-10-15. PR #23 at 9e51acb. Read-only; every claim below was checked by running
`checkIds` on probe inputs (a scratch script outside the repo) or by grepping the repo.

**Count: 0 CRITICAL · 2 HIGH · 2 MEDIUM · 3 LOW**

What holds up: prefix collisions (`T7.1` vs `T7.10`, `T98.010`, `T98.01-a`) don't match; a renamed or removed
`## Phase 0–7` heading fails loudly; a typo'd marker (`⊗`, `🖐️` with VS16) fails as "missing" rather than being
skipped; a row moved under a `###` sub-heading or after prose is still parsed; the main guard works when the script
runs through a symlinked path; Node 22 in every workflow. `pnpm check-ids --all` passes on the branch (exit 0, 92 IDs).

---

## HIGH 1: a TESTING.md row whose ID cell isn't exactly `| T<n>.<nn> |` is silently ignored
`parseTestingMd` (scripts/check-test-ids.ts:36) only treats a line as an ID row if it matches
`^\|\s*(T\d+\.\d+)\s*\|(.*)\|\s*$`. Any other shape is skipped with no error, so that ID stops being checked.
Probed, each with `ok: true` and "1 required" (the second row was never seen):
- `| **T98.02** | U | b |` (bold ID)
- `` | `T98.02` | U | b | `` (code-formatted ID)
- `  | T98.02 | U | b |` (indented)
- `| T98.02 | U | b` (no trailing pipe, which is valid GFM)
- `| T98.02a | U | b |` (suffixed ID)

**Failure scenario:** someone bolds a row to highlight it, or an editor/formatter drops trailing pipes from a table.
That row's test can then be deleted and `pnpm gate` stays green. The "phase has zero rows" guard only catches it if
*every* row in the phase is affected. This is exactly the "a TESTING.md edit silently drops checks" case the
ticket is meant to close, and the module comment says "Throws on a malformed row, so a typo can't silently skip an ID",
which isn't true for these shapes.
**Fix:** inside a phase section, treat any line starting with optional whitespace + `|` that contains
`T\d+\.\d+` in its first cell as an ID row candidate; if it doesn't match the strict regex, throw
(`malformed ID row: …`). Alternatively, count every `\bT\d+\.\d+\b` token in the first cell of each table line and
assert that count equals `rows.length`. Add one fixture test per shape listed above.

## HIGH 2: T7.04 counts as "present", but the gate never runs it
T7.04's tests live in `apps/video/test/compositions.test.ts`. The checker scans the whole repo, so it reports T7.04
present. But `pnpm test` excludes `@specimen/video` (package.json:11), the CI `gate` job doesn't even install it
(ci.yml:43), and the separate `video` job is skipped unless `apps/video`, the lockfile, package.json,
tsconfig.base.json or ci.yml changed (ci.yml:64–70). TESTING.md defines the phase gate as "every ID … is **present and
passing**", and this PR is what puts phase 7 into `--all`.
**Failure scenario:** a change in `packages/core` or `site/` that never touches apps/video breaks a
composition's frame count. Nothing runs T7.04, `pnpm gate` prints "all 92 … test IDs present (… T7.04)", and the
reader concludes phase 7 is fully gated. This is the same "presence ≠ passing" trap the T7.02 override comment was
written to prevent, but for T7.04 nothing says so.
**Fix (pick one):** (a) say so in the T7.04 row, the way T7.02 now does ("runs in the `video` CI job only, outside
`pnpm gate`"), and have the checker list IDs found only under `apps/video/` on a separate `outside gate:` line;
or (b) restrict the scan to the paths the gate actually runs and add an explicit, labelled exception for T7.04.
(a) is the smallest change. Either way the success line must stop presenting T7.04 like every other gated ID.

## MEDIUM 1: any quoted `T<id> ` / `T<id>:` in a test file counts as a test, including skipped tests, comments and error strings
`hasTest` (scripts/check-test-ids.ts:68) matches a quote followed by the ID and a space or colon, anywhere in any
scanned file. Probed as `ok: true`: `it.skip('T98.01 x')`, `test.fixme(…)`, `it.todo(…)`, `describe('T98.01 group')`
with no `it` inside it, `// see 'T98.01 later'`, `throw new Error('T98.01: x')`.
**Real instance:** `scripts/secret-scan.test.ts:112` has `throw new Error('T6.07: gitleaks is required in CI …')`. If
every `test('T6.07 …')` in that file were deleted or `.skip`ped, T6.07 would still be "present".
**Failure scenario:** a flaky e2e test is changed to `test.fixme('T7.03 …')` to unblock a merge; check-ids stays
green and nobody notices that the ID is no longer exercised.
**Fix:** anchor the match to a test call:
`\b(?:it|test)(?:\.(?:only|concurrent|each\([^)]*\)))?\(\s*['"\`]T7\.03[ :]` (deliberately excluding `skip`,
`todo`, `fixme` and bare `describe`), and fail with `skipped test for T…` if the only matches are
`.skip`/`.todo`/`.fixme`. Fixture tests for each case listed above. If that's out of scope for SPC-14, at least list it
as a known limit in the usage comment and TESTING.md, and open a follow-up ticket.

## MEDIUM 2: `--phase=7`, or `--phase` with no value, silently checks phase 0 and passes
Arguments are parsed with `args.indexOf('--phase')` and `?? '0'` (scripts/check-test-ids.ts:144–145). Verified:
`tsx scripts/check-test-ids.ts --phase=7` and `… --phase` both print
`check-ids: all 7 phase 0 test IDs present …` and exit 0. An unknown flag such as `--al` does the same.
**Failure scenario:** a future CI step or a reviewer runs `pnpm check-ids --phase=7` to confirm phase 7 and gets a green
result for phase 0.
**Fix:** accept `--phase=N` as well, reject unknown arguments and a missing value with exit 2, and don't default to
`'0'` when neither `--phase`, `--all` nor `SPECIMEN_PHASE` is given (print the usage). Also reject `--phase N --all`
together instead of quietly letting `--all` win.

## LOW 1: the success line reads "all 92 phases"
`check-ids: all 92 phases 0, 1, 2, … test IDs present` parses as "92 phases". Suggest
`check-ids: 92 required test IDs present across phases 0–7` and moving the 92-ID list to the end, or dropping it,
since the per-phase counts already carry it.

## LOW 2: the scan reads untracked and ignored files, so local and CI results can differ
`walk(root)` reads every `*.test.ts(x)` / `*.spec.ts` on disk apart from a short SKIP list. It doesn't skip
`.claude/` (where Claude Code can create nested worktrees), `test-results/` or `playwright-report/`, or untracked
scratch files. **Scenario:** an uncommitted local test, or a test in a nested `.claude/worktrees/x/`, carries the ID.
Local `pnpm gate` passes and CI fails (or, for the "dropped but still tested" rule, local fails while CI passes).
**Fix:** list files with `git ls-files -co --exclude-standard '*.test.ts' '*.test.tsx' '*.spec.ts'`, or add `.claude` to
SKIP at minimum.

## LOW 3: adding a planned `## Phase 8` table to TESTING.md turns main red
By design (PE change 2), `--all` gates every `## Phase <n>` heading. **Scenario:** the owner writes the Phase 8 test
plan before the code, as was done for phases 1–7, and `pnpm gate` fails on main for every PR until phase 8 ships.
**Fix:** document it in the TESTING.md legend ("a new phase's table lands in the same PR as its first tests"), or
support a phase-level "planned" marker that the checker lists without enforcing. Either is fine; it should be a
written decision, not a surprise.

(Not findings: IDs in `*.spec.tsx`, `*.test.mts` or `.js` files, and an ID-only name like `it("T7.01")`, aren't
matched. That fails loudly as "missing", which is the safe direction. Escaped `\|` in a cell also fails loudly.)
