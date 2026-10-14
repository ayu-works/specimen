# PR #24 (sprint/log → main), PE lens A, round 1

Reviewer: pe-1b · 2026-10-15 · head `d812649` · doc-only (13 files, +1104/−1), so this is the only review.

**Verdict: approve once CI `gate` is green.** 0 CRITICAL · 0 HIGH · 2 MEDIUM · 6 LOW. All are wording; per the stop
rule, doc-only fixes get no re-review.

## What I checked (and found correct)
- **Facts vs git/gh:** #9 → 82e48b2, #18 → 7fbadc2, #19 → bbc8854, #20 → 31fa181, #21 → 78c07f6, #22 → exec/spc-8
  (shipped in #19), #23 → 1150d70: all merged, SHAs match the summary and pe.md. `a8211ee` (SPC-13) and `8e023c0`
  exist. Main CI is green on 1150d70 (and Lighthouse on bbc8854). `pnpm check-ids --all` in my worktree: 92 required,
  phases 0–7, T6.01–T6.05 dropped, T7.04 outside the gate, T7.02 report-only: matches the summary.
- **No `site/` or `netlify.toml` change:** confirmed (the Netlify checks are "skipping"; no deploy cost).
- **Secrets:** nothing secret-shaped in the diff (pattern grep for key/token prefixes, long base64, emails). The
  `sk-…` in the audit is a truncated example message, the `req_…` is a request id, and the resume UUID is a session
  id. gitleaks is not installed locally; the CI `gate` job (which runs it) was still **pending** at review time.
- **CLAUDE.md conflicts:** merge rules (owner decides, main checkout, delete the branch), the commit/PR trailers,
  memory (orchestrator only), keys in `chrome.storage.local`: setup.md and the briefs agree with CLAUDE.md.
- **Folder layout:** setup.md §Tooling, both briefs and the newest orchestrator.md block use
  `specimen-herdr/specimen` + `specimen-herdr/worktrees/<ticket>`. Old `Specimen-wt` paths remain only in dated
  history blocks of orchestrator.md (fine as history).

## MEDIUM

**M1. After this merge, `main` says `docs/sprint/plan.md` is "current work", but during Sprint 2 it's Sprint 1's plan.**
- CLAUDE.md §Workflow (new wording) points at `docs/sprint/plan.md` for current work and drops the note about
  `sprint/log`. Both briefs say "the same files are in `docs/sprint/` on `main`".
- Failure: in Sprint 2 the live plan/setup are edited on `sprint/log` only. An executor working from `main`
  (worktrees branch from `origin/main`) reads CLAUDE.md, opens `docs/sprint/plan.md`, and follows Sprint 1's lanes and
  "Owns" table, or a stale setup.md rule.
- Fix: CLAUDE.md: "…current work in `docs/sprint/plan.md`. During a sprint the live copy is on branch `sprint/log`
  (worktree `specimen-herdr/worktrees/sprint-log`) and wins over `main`'s, which is the last merged sprint." In both
  briefs, replace "the same files are in `docs/sprint/` on `main`" with "`main` has the copy from the last sprint
  merge; the sprint-log copy wins".

**M2. setup.md's folder rule has no exception for review files, but the PE brief requires writing in the executor's worktree.**
- setup.md §Rules: "write … only inside your own worktree and your session scratchpad". The PE brief and setup.md
  step 5 both put review files "in the executor's worktree". The lens-B reviewer's location isn't stated either.
- Failure: a fresh reviewer (or a permission check) follows setup.md, refuses or is denied the write, and findings
  end up in chat or in the wrong place; or the two docs are read as contradictory and an agent improvises.
- Fix: add to the folder rule: "Exception: reviewers (PE and lens B) create their findings file
  `docs/sprint/reviews/<ticket>-<lens>-r<n>.md` in the executor's worktree, and nothing else there." State where a
  doc PR's review goes when there is no executor (this one is in the PE's worktree, per the orchestrator).

## LOW

- **L1. setup.md:70 relative path.** "`../worktrees/sprint-log/`" is right from the main checkout but wrong from a
  worktree (`worktrees/pe/../worktrees/…`). Fix: `specimen-herdr/worktrees/sprint-log/`, as in §Tooling.
- **L2. pe.md is stale on arrival.** It names the orchestrator `specimen-af` (now `specimen-53`) and an open thread
  about local branch `pe/spc-13-audit`, which no longer exists. Fix: name the current orchestrator or say "read
  ListAgents"; drop the branch thread. (I'll replace pe.md at my own handover anyway.)
- **L3. Executor brief: "Message the PE (`pe`)".** Session names have a suffix (setup.md §Tooling: `pe-5e`). Fix: "the
  PE (its session name is in your kickoff; check ListAgents)".
- **L4. linear.md: the `in-review` label is "retired (don't use it)" but still listed in **Labels**.** Fix: drop it
  from the list or mark it "(retired)" there.
- **L5. setup.md step 5: "Doc-only and config-only PRs (≤ ~30 lines, no logic) get the PE only."** Read literally,
  this 1104-line PR needs a lens-B review. Fix: say whether "≤ ~30 lines" applies to config only (likely intent), or
  that doc-only PRs of any size get the PE only.
- **L6. Absolute home paths in a public repo.** Both briefs, setup.md and orchestrator.md contain
  `/Users/<macOS username>/…`; the repo is public. Not a secret, but it publishes the local username and folder
  layout. Owner's call; fix if unwanted: write paths relative to `specimen-herdr/`.

Not findings (noted only): orchestrator.md "Facts worth keeping" still says "CLAUDE.md §Workflow is stale; SPC-12
fixes it" (history); setup-prompt.md is a generic template, so its `../<repo>-wt/<ticket>` path is intentional.
