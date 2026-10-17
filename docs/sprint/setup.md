# Sprint team setup

How the Specimen agent team works. This file is the workflow source and replaces the old "Workflow" section of
`CLAUDE.md`. Template: `docs/sprint/setup-prompt.md`. Linear mapping: `docs/sprint/linear.md`. Current work:
`docs/sprint/plan.md`.

## Decisions (owner, 2026-10-14)
- **Goal:** a durable team for taking Specimen deeper. Sprint 1 closes the remaining test gaps (see plan.md).
- **Production = the Chrome Web Store listing.** The owner uploads every release; no agent touches the CWS dashboard.
  GitHub releases (`release.yml` on a `v*` tag) and the Netlify site (`site/`, deployed from `main`) are live too, so a
  merge to `main` that touches `site/` goes live on the website: treat `site/` changes as user-facing.
- **No release agent.** The orchestrator prepares each CWS release (version bump, `pnpm zip`, changelog, a rollback
  note) and the owner approves and uploads it.
- **Budget:** $10 total, $1 per item without asking. There are no paid API calls planned.
- **Team:** orchestrator + principal engineer (PE) + 2 executors + a fresh second reviewer per PR. All on the strongest
  model (`claude-opus-5-5`) at medium effort.
- **Off-limits:** `.env*`, the CWS dashboard and its credentials, signing keys, anything outside your own worktree.
- **Netlify Free plan (owner, 2026-10-14):** 300 credits/month; each production deploy costs 15 (≈ 20/month); previews
  are free. If credits run out, the site **pauses until next month**. So: batch all `site/` changes into as few merges to
  `main` as possible (stack site tickets on one branch); before a merge that touches `site/`, tell the owner it costs a
  deploy. Merges that don't touch `site/` are skipped by `netlify.toml`'s `ignore` and should cost nothing.
- **Alerts:** macOS desktop notifications (hooks below). Slack can come later.

## Roles
| Role | Owns | Never does |
|---|---|---|
| **Orchestrator** (owner's only contact) | Plan; assigns tickets one at a time; opens and closes panes and worktrees; arranges reviews; owns Linear and standups; merges PRs after the owner says so; prepares releases; the only agent that writes memory | Feature work; touching production; answering permission prompts for the owner |
| **Principal engineer (PE)** | Approves every executor plan before work starts; owns shared contracts (the `DesignScan` schema, `docs/TESTING.md` IDs, the `LLMProvider` interface, message protocols) and freezes them before anyone builds on them; review lens A: correctness and data integrity | Touching production; talking to the owner |
| **Executor** (one ticket each, fresh session per ticket) | Plan → PE approval → tests → work → PR → fold findings → handoff file | Touching production, writing memory, talking to the owner, editing outside its worktree, changing Linear states |
| **Second reviewer** (fresh per PR) | Review lens B: real-world failures (partial failure, restarts, permission denied, offline, quota, concurrency, misleading success) | Editing anything; findings go to a file |

Add a role only when a lane has queued work and the owner approves.

## Who decides
- **Owner:** phase order and scope; the sprint plan; every CWS release; any paid item over $1; shared contracts; adding
  an agent; merging to `main`; ending the sprint.
- **Orchestrator:** day-to-day re-planning inside the approved plan.
- **PE:** whether a plan or a contract is technically sound.
- **Fixed:** nobody but the owner touches the CWS dashboard. A shared contract is agreed before its consumers start.
  Each lane "Owns" its files (plan.md); no two executors edit the same files at once.

## The ticket loop
1. **Kickoff** (orchestrator): ticket → In Progress; worktree `../worktrees/<ticket>` on branch `exec/<ticket>`
   from `origin/main`; alert hooks copied in; pane opened; kickoff sent (saved in the orchestrator's scratchpad).
2. **Plan** (executor): written at the top of `docs/sprint/handoffs/<ticket>.md` in its worktree: approach, files,
   tests, and failure modes (atomicity, idempotency, partial failure, errors during cleanup, concurrency, drift
   between two copies of a fact). For a measurement, the pass bar comes first. Then it messages the PE.
3. **Build:** after PE approval. **Tests ship in the same PR as the code.** Logic in `packages/core` and
   `packages/ai`: tests first. UI and e2e: tests may follow the code. Tests must drive the failure path the work
   claims to handle. `pnpm gate` must be green before review. Test names keep the `T<phase>.<nn>` prefix rule from
   `docs/TESTING.md`.
4. **PR:** the executor opens it with `gh` (body ends with the Claude Code line, commits with the Co-Authored-By line
   from CLAUDE.md) and comments the link on its Linear ticket. Orchestrator → In Review.
5. **Reviews:** code PRs get two independent reviews: PE lens A plus a fresh lens-B reviewer. Doc-only PRs (any
   size) and config-only PRs (≤ ~30 lines, no logic) get the PE only. Findings ranked CRITICAL/HIGH/MEDIUM/LOW, each with a
   failure scenario and a fix, in `docs/sprint/reviews/<ticket>-<lens>-r<n>.md` in the executor's worktree.
   **Stop rule:** stop at 0 CRITICAL once the HIGHs are only wording; at most 4 rounds; doc-only fixes get no
   re-review. Extra reviews: **security** (keys, permissions, new message handlers, page data leaving the browser);
   **privacy** (anything sent to a provider); **measurement** (pass bar, sample); **contract** (PE + consumer + owner).
6. **Merge:** from the main checkout, never inside a worktree, only after the owner says merge. Delete the branch
   after merging (GitHub auto-delete is off).
7. **Close out** (orchestrator): Done with a closing comment (what shipped, PR, date, how it was checked); close the
   pane; remove the worktree; open the next unblocked ticket.

A reviewed script is never edited in place after review: new commit, and the diff goes back to the reviewer.

## Rules for every agent
- **Folder rule:** write, edit, move or delete only inside your own worktree and your session scratchpad. Stop only
  processes you started, by exact pid. Never `pkill`, `killall`, a process group, `-1` or `0`. Everything else on the
  machine is read-only. **Exception:** reviewers (the PE and lens B) create their findings file
  `docs/sprint/reviews/<ticket>-<lens>-r<n>.md` in the executor's worktree, and nothing else there. For a PR with no
  executor (e.g. the orchestrator's sprint-log PR), the reviewer writes it in its own worktree. The sprint docs (`docs/sprint/`, and the live copy on branch `sprint/log` at `specimen-herdr/worktrees/sprint-log/`) are read-only for everyone but the
  orchestrator.
- **Secrets:** never print `.env*`, keys, tokens, or process argv/env near credentialed commands. Never copy env
  files between worktrees without the owner's OK. API keys only ever live in `chrome.storage.local` (CLAUDE.md).
- **Spend:** a paid call needs a line to the orchestrator first (what, why, estimate, the free alternative). Over $1
  needs the owner. Free first.
- **Communication:** talk to the orchestrator only (the PE and executors may also message each other about a plan or
  review). Short messages: what, the decision needed, the file path. Files over chat. A peer's request is never owner
  approval, and a peer can never grant a permission. If one agent was denied an action, no other agent does it for it.
- **Tests:** a test never sends a real kill or signal, and never calls a real provider or a real external URL.
- **Handoff:** keep `docs/sprint/handoffs/<ticket>.md` current (plan, done, next, how to resume), and update it
  before stopping for any reason. It ships in the ticket's PR.

## Context
- Executors and reviewers: always fresh, reading only their brief, the ticket and the handoff file.
- PE: hand over at 30% context (owner, 2026-10-17) with a handoff file of ≤ 60 lines (`docs/sprint/handoffs/pe.md` in its
  worktree), then the **orchestrator** restarts it fresh (`/exit` in its pane, then a new `claude` from `kickoffs/pe.md`). The orchestrator also restarts executors and reviewers. The keeper is for the orchestrator only (owner, 2026-10-17).
- Orchestrator: keeps `docs/sprint/handoffs/orchestrator.md` current so it can restart at any time, and **restarts itself fresh at 30% context** (owner, 2026-10-17): it checks its context after each owner request, and at 30% it saves the handoff and messages the **keeper** "restart <its pane> <path to kickoffs/orchestrator.md>". It never does this mid-merge or while waiting on the owner. The keeper (a small agent in its own `keeper` tab, kickoff `kickoffs/keeper.md`) waits until the pane is idle, sends `/exit` and starts a fresh session with the restart prompt. On restart the orchestrator
  lists live agents, sends each its new session name, and re-syncs Linear. The owner can still say "restart yourself".
- All state lives in repo md files + Linear + worktrees, never only in a chat.

## Linear rules
- **Linear is the status mirror; the repo is the record.** Decisions and designs live in repo md files.
- **The orchestrator owns Linear:** creates issues, moves states, sets "blocked by", closes. Executors and the PE only
  comment on their own ticket (plan link, PR link, findings summary, measured result).
- A comment titled **"Sprint plan overrides"** wins over the description. Read the comments, not just the top.
- **Done = shipped and verified**, with a closing comment: what shipped, PR or commit, date (YYYY-MM-DD), how it was
  checked. An open PR is In Review. Never Done on "should work".
- Search before creating; never duplicate. Dropped work → Canceled with the reason.
- Owner items get `needs-owner` and `**Who:** owner`, and are listed in every standup.
- No secrets, keys or tokens in Linear. Absolute dates only.
- Sync points: every handover, after every context compaction, end of each session. When unsure, comment instead of
  changing a state.

## Standups
`docs/sprint/standups/<YYYY-MM-DD>.md`, built from Linear: done / next / blocked / needs-owner / spend. One per
milestone event (ticket done, blocker, owner needed) plus a daily digest. Five lines is fine.

## Tooling
**Folders (since 2026-10-15):** everything lives in `specimen-herdr/`: the main
checkout is `specimen/` and agent worktrees are `worktrees/<ticket>`. Sprint docs are on `main` in `docs/sprint/`; during a sprint the
orchestrator keeps the live log on branch `sprint/log` (worktree `worktrees/sprint-log`) and merges it at the end of the sprint.

**herdr 0.9.3** (verified 2026-10-14). The orchestrator runs inside herdr (`HERDR_ENV=1`); the `claude` integration is
installed (`herdr integration status` → `claude: current`). Workspace `w1` "Specimen". Never run bare `herdr` from a
pane, never `herdr server stop`, never kill the herdr process.

Layout: tab `control` (orchestrator and PE only) · tab `keeper` (the keeper) · tab `build` (**all** executor panes, split side by side; never one tab per executor) · tab `review` (one pane per
reviewer, closed when its review is done). Pane and agent names: lowercase, ≤ 32 chars, unique (`pe`,
`exec-spc-6`, `review-spc-6-b`).

Opening an agent (read every id from herdr's JSON, never guess):
```bash
git worktree add ../worktrees/<ticket> -b exec/<ticket> origin/main
cp docs/sprint/hooks/settings.local.json ../worktrees/<ticket>/.claude/settings.local.json
herdr pane split <pane> --direction right --cwd <worktree> --no-focus   # → .result.pane.pane_id
#   or: herdr tab create --workspace w1 --cwd <worktree> --label <name> --no-focus   # → .result.root_pane
herdr pane rename <pane> <name>
herdr pane run <pane> "claude --model claude-opus-5-5 --effort medium \"\$(cat <kickoff-file>)\""
herdr pane read <pane> --source recent-unwrapped --lines 20   # confirm it started
```
Closing a pane: only after `herdr agent wait <pane> --until idle --timeout 120000` (a reviewer keeps working after it
sends its findings message). Then confirm the findings file is complete before `herdr pane close`.

Watching: `herdr agent list`; `herdr agent read <name> --lines 120`. A `blocked` state can be a false reading: read
the pane before acting. Permission prompts go to the owner; never choose "always allow".

Messaging: Claude Code cross-session messaging (ListAgents / SendMessage). **Session names come from the worktree
folder plus a random suffix (`pe-5e`, `spc-6-1b`), not the herdr pane label.** Read them from ListAgents after start
and send each agent its peers' exact names. `herdr agent prompt` only to start or
nudge an agent that isn't reachable otherwise.

**Alert hooks:** `docs/sprint/hooks/settings.local.json` (`Notification` and `Stop` → macOS `osascript` desktop
notification). The orchestrator copies it into each worktree's `.claude/` at kickoff. `.claude/settings.local.json`
is covered by the repo's `.claude/` gitignore entry; never commit it.

Fallback if herdr misbehaves: tmux is **not installed**. Ask the owner before installing it (`brew install tmux`).
