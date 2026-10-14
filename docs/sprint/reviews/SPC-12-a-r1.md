# SPC-12 lens A review, round 1 (PE, 2026-10-14)

PR #21, commit 17ca6a1, doc-only. Facts checked against `gh` and the repo on 2026-10-14.

**Result: 0 CRITICAL · 1 HIGH · 2 MEDIUM · 2 LOW.**

Verified correct:
- PRs #13–#18 and #20 are merged (#20 at 2026-10-14T13:36Z) and #19 is open, all as stated.
- CI run 38573173204 is `success` on `main` at 31fa181.
- The netlify.toml `ignore` really skips merges that don't touch `site/`.
- The CWS privacy URL is listed as an owner check, not as done.
- No GitHub release is claimed. Lighthouse is worded as a non-blocking report, and MCP as dropped, with T6.01–T6.05.
- The `sprint/log` pointer gives the `git show` path, and the two rules (tests ship with code, gate green before
  review) are kept inline.

## HIGH

**H1. CLAUDE.md lost the owner-merge rule.** The old step 6 said "it's merged when the user says so". The new Workflow
section keeps the testing rules but drops this one. CLAUDE.md is the only file every session loads, while setup.md is
on another branch and has to be fetched deliberately.
- *Failure scenario:* a fresh session on `main` (or a future contributor's agent) reads CLAUDE.md, sees approved
  reviews and merges a PR itself. Because a merge that touches `site/` deploys to Netlify, that also spends credits.
- *Fix:* add a third rule: "Only the owner decides a merge. Agents never merge without the owner's go-ahead, merges are
  done from the main checkout, and the branch is deleted afterwards."

## MEDIUM

**M1. The Netlify batching rule can't be reached from CLAUDE.md.** It's only in HANDOFF.md and IMPLEMENTATION.md
narrative.
- *Failure scenario:* a session fixing a small `site/` typo opens and merges its own PR, which costs a 15-credit
  deploy.
- *Fix:* add one line under Rules: "`site/` goes live on every merge to `main` (Netlify Free: 15 of 300 credits per
  deploy), so batch `site/` changes into one PR."

**M2. The Commands block is stale since #18 and #20.**
- `pnpm secrets` (T6.07) is missing.
- `pnpm test` is described as "Vitest, all packages", but it now excludes the video and also runs the
  `scripts/*.test.ts` node tests.
- `pnpm gate` is described as "everything above", but it also runs `pnpm secrets` and `check-ids --all`.
- `pnpm typecheck:video` / `pnpm test:video` aren't listed.
- *Fix:* add `pnpm secrets  # gitleaks over the whole git history (T6.07; skipped locally without gitleaks, required
  in CI)` and `pnpm typecheck:video && pnpm test:video  # the video app, outside the gate`, and correct the `test` and
  `gate` comments.

## LOW

**L1. The HANDOFF CI note is stale after #20.** The `video` job now also runs `pnpm test:video`, and triggers on root
`package.json`, `tsconfig.base.json` and `ci.yml` as well as `apps/video` and the lockfile. Update that sentence.

**L2. The Phase 3 status line still says "3.8 (review, tag) is pending".** Phase 3 shipped in v1.0.0, and no
per-phase tags exist. Append "superseded: shipped in v1.0.0", as was done for the milestone list.
