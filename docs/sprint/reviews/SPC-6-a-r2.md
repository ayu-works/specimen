# SPC-6 lens A review, round 2 (PE, 2026-10-14)

Commits 02e2e88 (lens A r1 fixes) and 773036c (lens B r1 fixes), reviewed as the diff from 67f0521.

**Result: 0 CRITICAL · 0 HIGH · 0 MEDIUM · 1 LOW. Lens A approves; stop rule met.**

r1 findings, checked:
- **M1 fixed.** `FINDINGS_EXIT = 3`, and exit 1 now counts as a scan error. The broken-config test runs the real binary
  and asserts `scan error (exit 1)`.
- **L1 fixed.** "Clean" now needs exit 0, no ERR/FTL line and at least one commit scanned, and the message prints the
  count. The ERR check can't misfire on file content, because on exit 0 there are no findings to print.
- **L2 fixed.** There's a real stash-only test (mutation-checked by the executor).
- **L3** is in the PR body.
- The B-H1 fix (git failure inside gitleaks → scan error, tested by deleting a blob object) also closes the "0 commits"
  path from the other side.
- `permissions: contents: read` and `persist-credentials: false` are fine.
- **New `.gitleaksignore` entry** (`02e2e88:docs/sprint/reviews/SPC-6-a-r1.md:…:11`): this is the r1 review quoting the
  same dummy test key. It's pinned to that commit, so it's OK. My mistake: future reviews won't quote secret-shaped
  strings.

## LOW

**L1. The no-allowlist test doesn't cover `[extend] disabledRules`.** `disabledRules = ["generic-api-key"]` in
`.gitleaks.toml` would silently turn off the rule that catches most keys, and the test only looks for allowlist
tables. *Fix (optional):* also assert no `disabledRules` line. Or assert the history test's `RuleID: generic-api-key`
hit, which it already does: that would go red, so this is belt and braces only.
