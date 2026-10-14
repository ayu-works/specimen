# SPC-6 handoff: T6.07 gitleaks scan of the whole history (CI + local)

Executor: exec-spc-6 (lane A) · Branch: `exec/spc-6` · Status: **reviews done, approved; waiting for the owner's merge** (PE approved 2026-10-14 with changes, folded in below)

## PE approval changes (2026-10-14, pe-5e) — these win over the plan below
1. Missing binary: warn+skip locally; fail when `CI` is truthy (set, not ""/"0"/"false") or `SPECIMEN_REQUIRE_GITLEAKS=1`.
   The skip line says the history was NOT scanned.
2. No fake-key commit is pushed anywhere. The failure is shown by the integration test + a pasted local run in the PR.
3. `--log-opts="--exclude=refs/stash --all"`, same locally and in CI (the stash stack is shared across worktrees).
4. The temp repo's git is isolated: `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `-c user.* -c commit.gpgsign=false`.
5. The history test asserts exit exactly 1 (the "found secrets" outcome), rule `generic-api-key`, `leaks found: ≥1`,
   and runs with the repo's real `.gitleaks.toml` and `.gitleaksignore`.
6. False positives only in `.gitleaksignore` by fingerprint; no path/regex allowlist in `.gitleaks.toml`.

## Plan (original)

### Approach
A small Node wrapper, `scripts/secret-scan.ts`, run as `pnpm secrets` and added to `pnpm gate`. It shells out to a
real `gitleaks` binary; it never reimplements detection. CI installs a **pinned gitleaks binary verified by
sha256** (no third-party action, no `GITHUB_TOKEN` needed), and the gate job checks out the full history.

What the wrapper does, in order:
1. Find `gitleaks` on `PATH` (or `GITLEAKS_BIN`). Check `gitleaks version` ≥ 8.19 (the release that added the
   `git` subcommand); an older version is a hard failure with an upgrade hint.
2. Refuse a shallow clone (`git rev-parse --is-shallow-repository` = `true`): "whole history" must mean it. Hard fail
   with "use fetch-depth: 0".
3. Run `gitleaks git --redact --no-banner --exit-code 1 --log-opts=--all .` with the repo's `.gitleaks.toml`
   (extends the default rules; empty allowlist to start). `--redact` because CI logs on this public repo are public.
   No report file is written or uploaded (it would hold the matches).
4. Map the result: exit 0 → "clean, N commits scanned"; exit 1 → fail with gitleaks' (redacted) findings; any other
   exit code or a spawn error → fail as "scan error", **never** reported as clean.

**Missing binary policy (decision for the PE):** I propose: local `pnpm gate` **warns and skips** (exit 0, loud
yellow "SKIPPED: gitleaks not installed, `brew install gitleaks`") so contributors without it can still gate; but
when `CI` is set, or `SPECIMEN_REQUIRE_GITLEAKS=1`, a missing binary **fails**. CI is the enforcing copy; it always
has the binary. Alternative if the PE prefers strict: fail locally too.

### Files (all lane A)
- `scripts/secret-scan.ts` — the wrapper; the decision logic is a pure exported function (`decide(...)`) so it can
  be tested without spawning.
- `scripts/secret-scan.test.ts` — tests (below), run with Node's built-in runner via `tsx --test` (no new deps).
- `.gitleaks.toml` — `[extend] useDefault = true`; allowlist only if triage needs it (each entry commented).
- `.gitleaksignore` — only if triage of the current history finds a false positive; fingerprint + reason each.
- root `package.json` — `"secrets": "tsx scripts/secret-scan.ts"`, `"test:scripts": "tsx --test scripts/*.test.ts"`;
  `test` becomes `pnpm -r --if-present test && pnpm test:scripts`; `gate` gains `&& pnpm secrets` (cheap, runs
  first so a leak fails fast: `pnpm secrets && pnpm typecheck && ...`).
- `.github/workflows/ci.yml` — gate job: `fetch-depth: 0`; a step that downloads gitleaks `vX.Y.Z` linux_x64
  tarball from the official GitHub release, checks the pinned sha256, puts it on `PATH`. Version + sha live only in
  that step's `env` (one copy).
- `docs/TESTING.md` — T6.07 row: note how it runs (`pnpm secrets`, CI-enforced). No ID/format change.
- `CONTRIBUTING.md` is lane B / not listed → I won't touch it; README note goes in the PR body instead (ask
  orchestrator if a contributor doc line is wanted).

### Tests (`scripts/secret-scan.test.ts`, names start `T6.07`)
Unit (pure `decide`, no spawning):
- `T6.07 a findings exit (1) fails the scan`
- `T6.07 an unexpected exit code or spawn error fails as a scan error, never as clean`
- `T6.07 missing gitleaks locally warns and skips; missing in CI (or SPECIMEN_REQUIRE_GITLEAKS=1) fails`
- `T6.07 a shallow clone fails` · `T6.07 gitleaks older than 8.19 fails`
Integration (real gitleaks, in a throwaway `git init` repo in `os.tmpdir()`, no network; `skip` with a reason when
the binary isn't installed locally, but **required** when `CI` is set so it can't silently skip there):
- `T6.07 a fake key committed and then deleted is still found in history` — commit a generic high-entropy
  `api_key = "..."`, delete it in the next commit, run the wrapper against that repo → non-zero, output redacted
  (the fake value does not appear in stdout/stderr).
- `T6.07 a clean repo passes`.
The fake key is **assembled at runtime** (string concat) so this test file itself never matches a rule; no allowlist
for test files. It's a generic-rule string, not a real provider's shape (no `sk-ant-`/`ghp_`/AKIA), so no partner
secret-scanning or push-protection noise.

### Failure modes
- **Silent pass** (the big one): scan errors, a missing binary in CI, a shallow clone or an old gitleaks must all
  fail, not print "clean". Each has a test above.
- **Secrets in logs:** `--redact` always; no report artifact; the integration test asserts the value isn't echoed.
- **Existing findings in history** (e.g. public keys in `fixtures/raw/*` captures): before wiring CI I run the scan
  once and triage. A real secret → stop and tell the orchestrator (rotate; no history rewrite on a public repo
  without the owner). A false positive → `.gitleaksignore` fingerprint with a reason. Results go in this file.
- **Drift between two copies:** the gitleaks version is pinned once (CI step env). Local uses any ≥ 8.19; default
  rules can differ by version, so CI is authoritative; noted in the script's message on a local pass.
- **Partial failure / cleanup:** the integration test's temp repo is removed in `finally` (`rm` with `force`); a
  cleanup error doesn't mask the test result. The wrapper has no state to clean up.
- **Concurrency/idempotency:** read-only scan; safe to rerun; CI `concurrency` group already cancels stale runs.
- **Download integrity:** sha256 mismatch → step fails (`sha256sum -c`), never runs an unverified binary.

### Check (ticket's "How to check")
- CI green on the PR, with the gitleaks step visible.
- Fail demo: push one commit with a generic fake key to `exec/spc-6`, capture the red CI output (redacted) into the PR
  body, then **force-push to drop it** (my own branch only). Note: GitHub keeps the dropped commit reachable via the
  PR's ref; since it's a fake generic string that's acceptable, but **PE: say if you'd rather I show the failure
  only locally + via the integration test** and skip pushing it.
- `rg "T6\.07" -g "*.test.ts" -g "*.spec.ts"` finds the ID. (`check-ids --all` still covers 0–5; extending it is SPC-14.)
- `pnpm gate` green locally (with gitleaks installed via brew, or the pinned binary in my scratchpad).

## Done
- `scripts/secret-scan.ts` (`pnpm secrets`, first step of `pnpm gate`), `scripts/secret-scan.test.ts` (10 `T6.07`
  tests via `pnpm test:scripts`, which `pnpm test` now runs), `.gitleaks.toml` (default rules), `.gitleaksignore`,
  CI gate job: `fetch-depth: 0` + gitleaks 8.30.1 linux_x64 checked against its sha256. TESTING.md T6.07 row notes how it runs.
- Triage of the existing history (43 commits): 1 finding, a false positive: the test constant `KEY` (an obvious dummy, `sk-test-` + digits) in
  `packages/ai/src/secrets/crypto.test.ts:11` (commit 9a369b2), a dummy plaintext for the T3.10 encryption test.
  Ignored by fingerprint. No real secrets found.
- Local `pnpm gate` green on 2026-10-14 with the pinned gitleaks (darwin_arm64 8.30.1, sha256 verified, in my scratchpad).
- Known limit: gitleaks reads `git log -p`, which shows no diff for merge commits, so a secret introduced only in a
  merge conflict resolution isn't seen. Accepted (default gitleaks behaviour); not in scope.

## Review round 1 (2026-10-14): how each finding was resolved
Lens A (`SPC-6-a-r1.md`, 0C/0H/1M/3L):
- **M1 fixed:** findings use `--exit-code 3`; exit 1 (a gitleaks fatal error) is a scan error. Real broken-config test.
- **L1 fixed:** a clean exit needs a `N commits scanned` line with N ≥ 1; the count is printed in the clean message.
- **L2 fixed:** a real stash-only-key test (it fails when `--exclude=refs/stash` is removed; checked by mutation).
- **L3 already done:** the merge-resolution limit was in the PR body from the start.
Lens B (`SPC-6-b-r1.md`, 0C/1H/2M/4L):
- **H1 fixed:** reproduced (missing blob → `ERR [git] fatal`, `0 commits scanned`, exit 0). Now any `ERR`/`FTL` line
  on exit 0 is a scan error, and 0/no commits scanned fails (L1 above). Integration test deletes the leaking blob's
  object and asserts a scan error, not clean. The exact `rev-list` count match was **not** done: gitleaks skips
  commits with no patch (empty commits, merges), so counts differ legitimately (here: 44 non-merge vs 43 scanned).
  The ERR check and N ≥ 1 cover the failure modes the review reproduced.
- **M1 fixed:** same as lens A M1 (code 3 rather than 99; either works, 3 is gitleaks' own docs example).
- **M2 fixed:** ci.yml has top-level `permissions: contents: read`, and both checkouts set `persist-credentials: false`.
- **L1 fixed (hint):** the findings message says every local ref is scanned and gives `git branch -a --contains <commit>`.
- **L2 fixed:** a T6.07 test asserts `.gitleaks.toml` has no allowlist section and still extends the default rules.
- **L3 won't fix: single maintainer** (orchestrator decision, 2026-10-14). The owner reviews and approves every merge,
  so CODEOWNERS on `.gitleaks.toml`/`.gitleaksignore` adds nothing.
- **L4 fixed:** `curl --retry 3 --retry-all-errors` (sha256 still checked); ENOBUFS has its own message.
- New ignore entry: committing the lens-A review (02e2e88) added its quote of the same dummy key to history; ignored by
  fingerprint rather than editing the reviewer's file.
- 16/16 T6.07 tests pass with `CI=true`; full `pnpm gate` green before the push.

## Review round 2 (2026-10-14)
- Lens A r2 (`SPC-6-a-r2.md`): 0C/0H/0M/1L, approved. **L1 fixed:** the config test also forbids `disabledRules`.

## Next
- Nothing for the executor. The orchestrator asks the owner to merge PR #18.

## How to resume
Read this file, then the ticket SPC-6 (and its comments). Branch `exec/spc-6` in this worktree.
