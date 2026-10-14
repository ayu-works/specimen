# Orchestrator handoff

Newest UPDATE block on top. A fresh orchestrator session reads this, then `docs/sprint/setup.md`, `plan.md`,
`linear.md`. The template these came from is `docs/sprint/setup-prompt.md`.

## UPDATE 2026-10-14 (sprint 1 set up; starting the smoke test)

**Where we are:** the owner approved the workflow, the plan and the backlog ("you propose"). Linear is built: team
Specimen/SPC, projects P-SPC-1 Quality & Tests (milestone "S1: test gaps closed") and P-SPC-2 Release & Site, the
labels, and tickets SPC-5 to SPC-14 with their "blocked by" links. The sprint docs are written on `sprint/log` (worktree
`../Specimen-wt/sprint-log`). Next: SPC-5 smoke test, then start the PE + lane A (SPC-6) + lane B (SPC-8).

**Owner decisions (2026-10-14):** production = CWS listing, and the owner uploads releases (no release agent). Lighthouse
is a non-blocking CI report. Doc/config-only PRs get the PE review only. The video test checks settings, never
renders. No empty Extension project until a feature is picked. Desktop notifications for alerts.

**Still waiting on the owner (needs-owner):**
- Add the **In Review** status in Linear and set On PR open → In Review, On PR merge → No action (Team settings →
  Issue statuses & automations). Until then, tickets with an open PR stay In Progress with a PR-link comment.
- SPC-9: manual checks. SPC-10: the MCP decision (backlog).
- Optional: create the initiative "Specimen after v1" in the app (the MCP can't).

**Facts worth keeping:**
- The deferred testing pass already shipped (PR #9). CLAUDE.md §Workflow is stale; SPC-12 fixes it.
- Executor worktrees branch from `origin/main`, so they don't contain `docs/sprint/`; briefs point to the sprint-log
  worktree's absolute path. Per-ticket handoffs and review files live in each executor's worktree and ship in its PR.
- The repo owner is a personal GitHub account, so gitleaks-action needs no licence.
- The claude.ai Linear connector is account-wide; no separate `linear` MCP is configured.
- herdr: workspace w1, the orchestrator pane is w1:p3. tmux isn't installed.
- User settings default to effort high; agents start with `--model claude-opus-5-5 --effort medium`.
- The Read tool is denied outside the main checkout; read sprint-log files with `cat` via Bash.

## History (setup)

### UPDATE 2026-10-14 (owner approved the workflow, the test run, and "you propose the backlog")

- **Finding:** the "deferred testing pass" is already done (PR #9, see docs/HANDOFF.md). `pnpm check-ids --all` shows 87/87 IDs for phases 0–5, and CI on main is green. Sprint 1 was rescoped to the remaining gaps: T6.07 gitleaks; T7.01–T7.04 site/video tests; check-ids covering phases 6–7, with the dropped MCP IDs T6.01–6.04 marked as such; a failure-path audit; stale docs; and the owner's manual checks.
- The Linear outline and the Sprint 1 plan are shown to the owner. **Waiting for approval before creating anything.** "In Review" is still missing in Linear.

### UPDATE 2026-10-14 (later)

- The claude.ai Linear connector now works (account-wide, so worktree sessions get it too). There is no separate `linear` MCP configured. Workspace `ayu-works`.
- The team is renamed: **Specimen / SPC** (id 504055dc-fd35-45c0-83ed-a181e7163a26).
- The team's states are Backlog, Todo, In Progress, Done, Canceled and Duplicate. **There is no In Review.** The MCP can't create states, so the owner was asked to add one.
- GitHub is connected in Linear. The owner was asked to set "On PR merge" to No action (Team settings → Issue statuses & automations → Git automations).
- Not done yet from the setup prompt:
  - the Notification/Stop alert hooks (the owner must pick the channel: desktop notification or Slack, and Slack isn't authenticated);
  - the herdr smoke test (3 panes, hooks fire, a `/login` switch loses nothing).
- Still open: approval of the hybrid workflow (including no release agent), and what to work on after testing.

### UPDATE 2026-10-14 (setup, before any Linear or agent work)

**Where we are:** Step 0 (interview) is done. Step 1 (Linear) is half done. Nothing is committed and no agents are started. This file and `sprint-team-setup-prompt.md` are untracked.

**Owner's answers (Step 0):**
- Goal: a durable team setup for taking Specimen deeper. Sprint 1 is the deferred testing pass: write the missing tests from `docs/TESTING.md`, then get `pnpm gate` green for every phase.
- Production: the **Chrome Web Store listing** only. The GitHub releases and the Netlify site are live too, but they are not "production" here.
- Linear: brand new. Workspace `ayu-works` (if the owner used that name), team **Specimen**, key **SPC**, region **EU**. The owner was offered the GitHub integration (scope: `ayu-works/specimen` only); it's unclear whether they connected it.
- Budget: defaults ($10 total, $1 per item). There are no paid API calls for now.
- Team: defaults. 2 executors plus the PE, all Opus 5.5 at medium effort.
- Off-limits (defaults, not objected to): `.env*`, the CWS dashboard and its credentials, signing keys, and anything outside the agent's own worktree.
- Conflicts with the old CLAUDE.md workflow: the owner said "build our own which is better".

**Proposed hybrid workflow (waiting for the owner's approval):**
- A fresh executor session per ticket in its own worktree, with the PE approving the plan first.
- Tests ship in the same PR as the code: tests first for `packages/core` logic, tests may come after the code for UI. Tests must cover the failure path, and `pnpm gate` must be green before review.
- Two reviews per PR (PE lens A plus a fresh lens-B reviewer); doc-only PRs get the PE only.
- No release agent for now. The orchestrator prepares each CWS release; the owner approves and uploads it.
- The sprint docs become the workflow source; trim the CLAUDE.md Workflow section to point to them.

**Tooling state:**
- herdr 0.9.3: the Claude integration is current and this pane has `HERDR_ENV=1`. tmux is not installed (no fallback).
- The claude.ai Linear connector fails ("Server not found", req_011Cg27jDYXS5QYJ6XnCWZ1L). Added instead: `claude mcp add --scope user --transport http linear https://mcp.linear.app/mcp` (user scope, so the worktrees get it too).
- **Next for the owner:** `/exit` → `claude --continue` → `/mcp` → **linear** → Authenticate → Allow. The Linear account in the browser doesn't need to match the Claude account.
- CI on `main` was green at ff7c180.

**Open questions for the owner:**
1. Approve the hybrid workflow above?
2. What to go deeper on after testing (or "you propose", in which case draft a backlog from `docs/PLAN.md`)?
3. Was GitHub connected in Linear? If yes, turn off "PR merged → Done" in Team settings → Workflow.

**Next steps for the orchestrator (in order):**
1. Verify the Linear MCP works by listing teams and confirming Specimen/SPC.
2. Draft the Linear structure (initiative, 2–5 projects, milestones, labels) and the file list from Step 4, plus a ≤15-line plan summary. Show them to the owner and wait.
3. On approval: create the Linear structure and the first tickets, write `docs/sprint/*`, commit to `sprint/log`, create the PE and executor worktrees, open herdr panes, and send the kickoffs.
