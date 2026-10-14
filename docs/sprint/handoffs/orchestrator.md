# Orchestrator handoff

**Resume this orchestrator:** in the main `Specimen` folder, run `claude --resume 015cf71f-2911-4db4-8f1b-44b3361da55e`
(or `claude --continue`). The session may be listed as "Handoff document". The `/resume` list is per folder.

Newest UPDATE block on top. A fresh orchestrator session reads this, then `docs/sprint/setup.md`, `plan.md`,
`linear.md`. The template these came from is `docs/sprint/setup-prompt.md`.

## UPDATE 2026-10-15 (resumed after the Claude Code update)

- The owner updated Claude Code (2.1.300) and resumed. **The orchestrator's session name is now `specimen-af`** (it was specimen-b0); agents were told. Session names change on restart: re-read ListAgents and re-send names.
- The owner OK'd the SPC-14 ⊘ format; spc-14-6b is building; pe-5e will review (lens A + contract), plus a fresh lens-B reviewer.

## UPDATE 2026-10-14 14:01 (PAUSED by the owner)

- The owner said "stop everything for now". Nothing merges and nothing new starts until they say resume.
- pe-5e and spc-14-6b were told to save their handoffs (pe.md, SPC-14.md in their worktrees) and stop. Their panes and worktrees stay open so they can resume.
- To resume: read this file, then SPC-14.md in ../Specimen-wt/spc-14 and pe.md in ../Specimen-wt/pe; `herdr agent list`; continue the SPC-14 plan approval.

## UPDATE 2026-10-14 (website shipped in one deploy; SPC-14 last)

- **Done:** SPC-5, 6, 7, 8, 11, 12, 13, 15. #19 (with #22 folded in) merged as bbc8854: **one Netlify deploy**; the live site was checked with curl (new CSP, self-hosted fonts, no Google requests, redirects OK); main CI and Lighthouse green. #21 merged as 78c07f6.
- An exec/spc-8 conflict with main (pnpm-lock.yaml only) was fixed by the orchestrator in 18bb7f4 with `pnpm install --lockfile-only` + a frozen-install check. Lesson: a stacked/held PR goes stale while main moves, so check `mergeStateStatus` before waiting on CI (a conflicted PR gets no Actions run).
- **Live:** pe-5e (w1:p9), spc-14-6b (w1:pK, worktree spc-14). SPC-14 changes the TESTING.md format (a contract): PE approval, then the **owner's OK**, before merge.
- **Wrap-up after SPC-14:** merge sprint/log into main (a docs PR; no site/ change); move both folders into `specimen-herdr/` (no live agents; `git worktree repair`; copy the memory dir to the new project key); close the sprint; then the SPC-22 critique-panel spike (Groq via BYOK; the owner tests).
- New backlog: SPC-22 (idea spike), SPC-23 (/fonts Cache-Control).

## UPDATE 2026-10-14 (#20 merged; SPC-12 started; owner decisions)

- **SPC-7 Done:** #20 merged as 31fa181; main CI green.
- **Owner decisions:** (1) move both folders into one `specimen-herdr/` folder **at the end of the sprint** (no live agents; `git worktree repair`; copy the Claude memory dir to the new path key). (2) Lighthouse **option A**: self-host the fonts, CSP font-src 'self', drop fonts.googleapis. CSP `connect-src 'self'` (the owner's option A as presented; a brief 'none' detour was withdrawn); Press Start 2P uses the unmodified upstream font (OFL Reserved Font Name). (3) **No release yet:** SPC-16 to SPC-21 stay in the Backlog.
- Live: pe-5e (w1:p9), spc-11-14 (w1:pF, stacked on exec/spc-8), spc-12-f8 (w1:pH, docs, base main). The SPC-12 CLAUDE.md pointer notes the sprint docs are on sprint/log until the end of the sprint.
- Remaining: SPC-11 → fold into #19 → merge #19 (1 deploy); SPC-12; SPC-14 last (after SPC-11). Then: merge sprint/log, move folders, close the sprint.
- herdr: `pane split` only takes right|down.

## UPDATE 2026-10-14 (#18 merged; SPC-7 and SPC-11 started)

- **SPC-6 Done:** #18 merged as 7fbadc2 (the owner said ok); main CI green; remote branch and worktree deleted.
- **#19 is held on purpose** (the owner is on Netlify Free): SPC-11 is stacked on exec/spc-8 (PR base = exec/spc-8, Lighthouse in its own lighthouse.yml). Merge #19 once, after SPC-11 lands in it, telling the owner it costs one deploy.
- Live sessions: pe-5e (w1:p9), spc-7-08 (w1:pE, worktree spc-7, lane A, owns ci.yml), spc-11-14 (w1:pF, worktree spc-11). The spc-8 worktree is kept (clean) until #19 merges; its session is closed.
- Next in lane A after SPC-7: SPC-14 (check-ids 0–7), blocked by SPC-7, SPC-8 and SPC-11. Lane B after SPC-11: SPC-12 (docs).
- The Extension audit tickets (SPC-16 to SPC-21) wait for the owner to decide (a v1.0.1 CWS release).

## UPDATE 2026-10-14 (reviews running; audit filed)

- PR #18 (SPC-6): lens A r2 approved and lens B r1 folded in. Waiting for the executor to commit the review files, then CI green, then **ask the owner to merge**.
- PR #19 (SPC-8 + SPC-15): r1 folded in (and a second real overflow fixed in site/index.html); PE round 2 underway. Both site/ changes go live on merge.
- SPC-13 is Done; HIGHs filed as SPC-16 to SPC-21 in the new Extension project (Backlog). The owner decides whether to pull them into the sprint.
- The owner added the "In review" status, so the `in-review` label is retired. Unknown: whether "On PR merge → No action" was set.
- Reviewer panes are closed after `herdr agent wait --until idle`.

## UPDATE 2026-10-14 (team running)

- SPC-5 is Done. The owner chose auto mode for agents and skipped the /login test; desktop alerts work.
- Live: pe (pane w1:p9, worktree ../Specimen-wt/pe, branch pe/spc-13-audit), exec-spc-6 (w1:pA, ../Specimen-wt/spc-6), exec-spc-8 (w1:pB, ../Specimen-wt/spc-8). Tabs: control (w1:t3), build. Kickoffs are in the orchestrator scratchpad (kickoff-*.md).
- SPC-6, SPC-8 and SPC-13 are In Progress.
- The owner couldn't add the In Review status, so we use the `in-review` label instead (linear.md). The Git automation is left at Linear's defaults, and a merge may auto-Done a ticket: verify right after each merge.

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
