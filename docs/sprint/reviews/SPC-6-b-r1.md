# SPC-6 review: lens B (real-world failures) + security, round 1

Reviewer: fresh lens-B reviewer · PR #18 at `67f0521` · 2026-10-14
Checked by hand with the pinned gitleaks 8.30.1 (darwin_arm64, sha256 checked against the release
`checksums.txt`) in scratch repos in my scratchpad. Nothing was pushed, and nothing ran against the real remote.

**Count: 0 CRITICAL, 1 HIGH, 2 MEDIUM, 4 LOW**

What holds up: the linux_x64 sha256 in ci.yml matches upstream `gitleaks_8.30.1_checksums.txt`. tar extracts only
the `gitleaks` member. `--redact` is always on and no report file is written. The `.gitleaksignore` entry is pinned
to one commit, file, rule and line, and that line is an obvious dummy (`'sk-test-' + digits`). `.gitleaks.toml` has
no allowlist. Shallow clones and old versions are refused. The real repo's scan (48 commits, 3.2 MB) takes 0.3 s,
so speed is not a concern for years.

---

## HIGH

### H1. A git failure inside gitleaks exits 0, and the wrapper reports "clean, whole history scanned"
gitleaks 8.30.1 runs `git log -p`. When git writes anything to stderr, gitleaks logs `ERR ... "stderr is not
empty"` and stops reading. It then prints `0 commits scanned.` / `no leaks found` and **exits 0**. `onScan(0)` maps
that to `ok: true`. The `rev-parse` pre-check only catches "not a repo". It does not catch errors that come later.

Reproduced end to end through `scan()`:
- A repo where a fake key was committed and then deleted, after which the leaking blob's object file is removed
  (`git log -p` → `fatal: unable to read <sha>`). Result: `secrets: clean, whole history scanned`, exit 0. With
  the object intact, the same repo gives `2 commits scanned`, `leaks found: 1`.
- `--log-opts=--bogus-flag` (for example, a future edit to `LOG_OPTS`, or an older git that lacks an option) also
  gives `0 commits scanned`, exit 0.
- A freshly `git init`-ed repo with no commits also comes back "clean".

How this happens in practice: a corrupt or missing object, a dangling ref seen by `--all` (refs are shared across
all the sprint worktrees, so one worktree's broken branch affects every gate), a partial clone (`filter:
blob:none`) with no network, or any git `warning:` on stderr. This is the "passes because it scanned nothing" case
that the plan names as the main failure mode, and it isn't covered.

**Fix** (in `scan()`, with a unit test for each case in the pure decision layer):
1. Parse `(\d+) commits scanned` from the output. On exit 0, require that the line is present and that N ≥ 1.
   Better still, require N to equal `git rev-list --count --exclude=refs/stash --all` (count the merge commits
   correctly; `--no-merges` may be needed to match gitleaks' count). If they differ, fail with "scan error".
2. Treat any `ERR`/`FTL` line, or `[git] fatal`, in the output as a scan error even when the exit code is 0.
3. Add an integration test: commit a fake key, delete it, remove the blob object, and assert `ok: false` and not
   `/clean/`. This drives the failure path the PR says it handles.

## MEDIUM

### M1. Exit 1 is ambiguous: gitleaks fatal errors also exit 1, and they are reported as "found secrets"
`--exit-code 1` uses the same code as zerolog's `Fatal`. A broken `.gitleaks.toml` (`toml: expected character =`)
and a missing config file both exit 1. The wrapper then prints `secrets: FAILED, gitleaks found secrets (above)`.
The run still fails, so nothing passes silently. But the message is wrong, and someone triaging "found secrets" may
go looking for a leak that isn't there, or add a `.gitleaksignore` entry to make it stop.
**Fix:** pass a distinct code, e.g. `--exit-code 99`. Map 99 → findings and 1 → "scan error (gitleaks fatal)".
Update the PE's "exit exactly 1" test assertion to the new code. Note: a missing `--gitleaks-ignore-path` is
silently accepted (the scan runs stricter), which is fine.

### M2. CI workflow has no `permissions:` block, and checkout keeps its token while `pnpm gate` runs repo code
`gate` uses the repository's default `GITHUB_TOKEN` scope. On `push` to `main` that may be write. Since
`actions/checkout` defaults to `persist-credentials: true`, the token sits in `.git/config` during
`pnpm i` + `pnpm gate`, which run every dependency's install scripts and the tests. PRs from forks get a read-only
token, so they are not the risk. A compromised dependency on a `main` push is. This predates the PR, but the PR
changes this job and is the security ticket, and gitleaks needs no token at all.
**Fix:** add top-level `permissions: { contents: read }` to ci.yml, and `persist-credentials: false` on both
checkouts. (`fetch-depth: 0` still works, since the fetch happens before the token is dropped.)

## LOW

### L1. `--all` scans every local ref, including other sprint worktrees' branches; CI scans every origin branch
Locally, refs are shared across worktrees, so a fake key on `exec/spc-8` fails the gate in `spc-6`. In CI,
`fetch-depth: 0` fetches every branch, so a key left on any stale branch turns every PR red. The output does give
the commit, but not the ref, and the message says "found secrets (above)" as if the cause were in this branch.
**Fix:** this is the intended behaviour, so keep it. On failure, print a hint such as "the commit may be on another
branch: `git branch -a --contains <sha>`".

### L2. Future `pnpm capture` fixtures will invite a path allowlist
`fixtures/raw/*.json` holds real sites' pages. Public browser keys embedded in sites (Google `AIza…`, Algolia,
Sentry DSNs) match default rules. Today there are none (triage: 1 finding). The first capture that brings one in
will fail the gate, and the easy fix is `paths = ['fixtures/raw']`, which the `.gitleaks.toml` comment forbids.
Nobody enforces that comment.
**Fix:** add a short line to the T6.07 row or the capture script's docs: a key found in a capture means "strip it
from the capture, or add a fingerprint entry". Optionally, add a T6.07 unit test asserting that `.gitleaks.toml`
has no `[allowlist]`/`[[allowlists]]`, so the rule is checked rather than only written down.

### L3. The PR's own `.gitleaks.toml` / `.gitleaksignore` decide what is checked in that PR
CI reads both files from the PR's checkout. A PR (or an agent trying to get a red gate green) can add an ignore
entry or an allowlist in the same diff as the key. Review would see it, but only if someone looks.
**Fix:** add these files to CODEOWNERS (owner review required), or have the CI step read them from
`origin/main` via `git show origin/main:.gitleaksignore`. CODEOWNERS is the cheaper option.

### L4. The download has no retry, and the wrapper's ENOBUFS case is reported as "did not run"
`curl -fsSL` with no `--retry` makes a short GitHub blip a red gate. Add `--retry 3 --retry-all-errors`; this is
safe because the sha256 check still runs. Separately, with `--verbose` and many findings, output over the 64 MB
`maxBuffer` makes `spawnSync` fail with `ENOBUFS`. That gives "gitleaks did not run", which still fails but is
misleading. Not worth fixing beyond a clearer message.

---

Not findings: commit messages and annotated tags are not scanned (`git log -p` reads patches only), and secrets
that appear only in a merge resolution are missed. Both are gitleaks defaults and the handoff already lists the
merge case.
