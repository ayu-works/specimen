# SPC-6 lens A review, round 1 (PE, 2026-10-14)

PR #18, commit 67f0521. Scope: correctness and data integrity of `scripts/secret-scan.ts`, its tests, `.gitleaks.toml`,
`.gitleaksignore`, the CI step and the `package.json` wiring.

**Result: 0 CRITICAL · 0 HIGH · 1 MEDIUM · 3 LOW.** Approve after the MEDIUM (or a written reason to skip it).

Checked and fine:
- **Allowlist risk.** `.gitleaks.toml` only extends the default rules, with no path or regex allowlist. `.gitleaksignore`
  has one entry, pinned to `commit:file:rule:line` (9a369b2, `crypto.test.ts:11`). I checked that line at that commit:
  `const KEY = 'sk-test-1234567890'`, an obvious dummy. Because the entry is pinned to that commit, the same string in
  a new commit or file is still reported. Neither file can hide a future real key.
- **Pinned binary.** The CI sha256 `551f6fc8…70eb` matches `gitleaks_8.30.1_checksums.txt` on the official v8.30.1
  release, and `sha256sum -c` fails the step on a mismatch.
- **Can T6.07 fail?** Yes. The history test asserts that exit 1 maps to "found secrets", that `RuleID: generic-api-key`
  and `leaks found: N≥1` appear, and that the fake value is redacted. It runs with the repo's real config and ignore
  file. In CI a missing binary makes the test module throw, so the tests can't skip there.
- **No silent pass in the wrapper.** A missing binary in CI, an old or unparseable version, a shallow clone, a spawn
  error, a non-0/1 exit and ENOBUFS (maxBuffer) all fail.
- `CI` truthiness matches the plan, the temp repo is isolated from the user's git config, refs/stash is excluded,
  findings are redacted, no report file is written, and the TESTING.md edit is wording only (the ID is unchanged).

## MEDIUM

**M1. Exit 1 means two things.** `scripts/secret-scan.ts:111` passes `--exit-code 1`, and `onScan` maps 1 to "found
secrets". But gitleaks also exits 1 on its own fatal errors, such as a bad `--config`, an unreadable ignore file or a
`git log` failure from a bad `--log-opts` (zerolog `Fatal` calls `os.Exit(1)`).
- *Failure scenario:* someone adds a typo to `.gitleaks.toml`. CI goes red with "gitleaks found secrets (above)". The
  contributor then hunts for a leak that doesn't exist, or worse, adds a `.gitleaksignore` entry to make it go away.
  It is not a silent pass, but the message is misleading and points people toward the allowlist.
- *Fix:* use a findings code that gitleaks never uses for errors, e.g. `--exit-code 3`, and map 3 to "found secrets"
  and 1 (and anything else) to "scan error". Update the unit test, and add a test that runs the real binary with a
  broken config file (`--config` pointing at a temp file containing `[[`) and asserts "scan error", not "found
  secrets". The `RuleID` assertion in the history test already guards the findings side.

## LOW

**L1. A scan that covered nothing passes.** If `--log-opts` selected no commits, gitleaks prints "0 commits scanned /
no leaks found" and exits 0, so the wrapper reports "clean, whole history scanned". It can't happen with the current
`LOG_OPTS`, because the history test proves commits are reached. *Fix (optional):* parse `(\d+) commits scanned` from
the verbose output and fail on 0, and print N in the clean message, so "clean" says how much history it covered.

**L2. The stash test can't fail on behaviour.** `secret-scan.test.ts` (the "excludes the shared stash ref" test) only
asserts the constant equals itself. *Fix (optional):* in a temp repo, put the fake key in a stash only
(`git stash push`), then assert `scan()` is clean. That proves gitleaks passes `--exclude` through to `git log` in the
right order.

**L3. The known limit is recorded only in the handoff.** Secrets added only in a merge-conflict resolution are not
seen (`git log -p` shows no merge diffs). It's fine to accept, but put one line in the PR body so it isn't lost when the
handoff file ages.
