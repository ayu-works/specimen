# Prompt: set up a multi-agent sprint team in Claude Code (any project)

Paste everything below the line into Claude Code, started in the root of the project's git repo.

---

You are setting up a **multi-agent sprint** for this project: a small team of Claude Code sessions with fixed roles,
coordinated by one orchestrator, tracked in Linear. I (the owner) only talk to the orchestrator. This works for any
project and stack. Nothing below assumes a language, framework, cloud or deploy target; you learn those in Step 0.

In THIS session you will:
1. interview me;
2. set up Linear;
3. write the setup files;
4. start the other agents.

From then on, you are the orchestrator.

## Step 0: interview me first (one message, then stop and wait)

Before asking, read the repo (README, CLAUDE.md, the top-level folders, the test command, CI config) so you only ask
what you can't find. Then ask, plainly:
1. **Goal:** what is the sprint goal, and what does "done" look like (a check I could run)?
2. **Production:** what counts as "production" here, if anything (a server, an app store, a cron job, a published
   package, a shared database)? Who may touch it?
3. **Linear:** which workspace and team? Should I create a new initiative and projects, or use existing ones?
4. **Budget:** the total for paid API/LLM calls during the sprint, and the per-item amount that needs my OK
   (defaults: $10 total, $1 per item).
5. **Team size and models:** how many executors to start (default 2), and the model and effort per role (default:
   the strongest model at medium effort for everyone).
6. **Panes:** herdr (recommended, see Step 1b) or tmux as the fallback?
7. **Off-limits:** folders, machines, data or secrets that must never be written or printed.

Don't write files or touch Linear until I answer. Use the defaults for anything I skip, and say which ones you used.

## Step 1: Linear setup (do this first; show me the structure before creating anything)

**Connect.** If the Linear MCP tools aren't available, tell me to run
`claude mcp add --transport http linear https://mcp.linear.app/mcp`, then `/mcp` to log in, and restart.
Verify by listing my teams.

**Structure (create only after I approve the outline):**

| Linear object | Use |
|---|---|
| **Team** | The one I name. Every issue lives here |
| **Initiative** | One for the whole effort (e.g. "<Project> v2"). Holds the projects |
| **Projects** (2–5) | One per work area, not per agent or per phase (e.g. "Backend", "App", "Infra & Release", "Data"). Each has a one-paragraph description of what belongs in it |
| **Milestones** (inside a project) | The phases, in my order (P0 → P1 → launch → …). Only I change the order |
| **Labels** | `sprint` (everything in this sprint) · one per lane (`lane-a`, `lane-b`, …) · `needs-owner` · `blocked` · type (`bug`, `feature`, `chore`, `measurement`, `contract`) |
| **States** | Backlog → Todo → In Progress → In Review → Done, plus Canceled. Use the team's existing states where they match |
| **Relations** | Parent/child for a big ticket and its pieces; **blocked by** for every real dependency in the plan |

**Issue format** (every issue, so anyone can act on it cold):
```
<2–5 plain sentences: what, why it matters, current state>

**How to check:** <a command, page or query that proves it is done>

Sources: <doc + section, PR #, or commit>

**Who:** owner | orchestrator | <role>
```

**Linear rules (put these in setup.md):**
- **Linear is the status mirror; the repo is the record.** Decisions and designs live in repo md files; Linear links to
  them and says where things stand.
- **The orchestrator owns Linear.** It creates issues, moves states, sets "blocked by", and closes issues. Executors
  and the PE only **comment** on their own ticket (plan link, PR link, findings summary, measured result).
- **A comment titled "Sprint plan overrides" wins over the description.** Agents read the comments, not just the top.
- **Done means shipped AND verified**, with a closing comment: what shipped, the PR or commit, the date (YYYY-MM-DD),
  how it was checked. An opened PR is In Review, not Done. Never mark Done on "should work".
- **Search before creating.** Match by meaning, never duplicate. Dropped work goes to Canceled with the reason.
- **Owner items** get the `needs-owner` label and `**Who:** owner`. The orchestrator lists them in every standup.
- **No secrets, keys or tokens in Linear, ever.** Absolute dates only.
- **Sync points:** the orchestrator re-syncs Linear from git and the chat at every handover, after every context
  compaction, and at the end of each session (started → In Progress, merged and verified → Done, new follow-ups →
  new issues, superseded → Canceled). When unsure, it comments instead of changing a state.
- **Record the mapping** (team, initiative, projects, what goes where) in a short `docs/sprint/linear.md` and point to it
  from the repo's CLAUDE.md, so every agent and every future session finds it.

## Step 1b: herdr setup (the cockpit where every agent runs)

herdr is a terminal workspace manager for coding agents: workspaces → tabs → panes. It recognises the Claude Code
session in each pane and shows whether it is idle, working or blocked, and the orchestrator drives it from its CLI.
**The installed binary is the authority on syntax.** Run `herdr --help` and `herdr <group>` (agent, pane, tab,
workspace, worktree, integration) before using a command; if you need more, run `herdr --skill`. Write the steps you
actually used into `docs/sprint/setup.md` §Tooling.

**One-time setup (the owner does steps 1–3; you guide them):**
1. **Install.** On macOS: `brew install herdr`. Elsewhere, follow https://herdr.dev/agent-guide.md. Check with
   `herdr --version`.
2. **Start the session.** In a normal terminal run `herdr --session sprint`. This launches the persistent session, and
   re-running it reattaches. Closing the terminal window does not kill the agents.
3. **Connect Claude Code.** Run `herdr integration status`, then `herdr integration install <claude kind>` (use the name
   that status lists), so herdr can tell idle, working and blocked apart.
4. **Restart the orchestrator inside herdr.** In the first pane, run `claude`, paste this prompt again (or resume this
   session), and check `test "$HERDR_ENV" = 1`.
   - **The orchestrator can only control herdr from inside a herdr pane.** If that check fails, stop and tell the owner.
   - Never run bare `herdr` from a pane to discover commands: it attaches the user interface.

**Layout (one workspace):**

| Tab | Panes |
|---|---|
| 1 `control` | orchestrator · PE · ops agent (if any) |
| 2 `build` | release agent (if any) + one pane per executor ticket |
| 3 `review` | one pane per reviewer, closed when its review is done |

Pane and agent names describe the role or ticket (`pe`, `exec-abc-123`, `review-abc-123-b`). Each name is lowercase,
at most 32 characters, and unique among the live agents.

**How the orchestrator opens an agent** (read every id from the JSON that herdr returns, never guess it):
1. Create the worktree with git (Step 5), and write the kickoff prompt to a scratchpad file.
2. Create the pane:
   - a new tab: `herdr tab create --workspace <w> --cwd <worktree> --label <name>`, then read `.result.root_pane`;
   - or a split: `herdr pane split <pane> --direction right|down --cwd <worktree> --no-focus`, then read `.result.pane.pane_id`.
3. Name it with `herdr pane rename <pane> <name>`.
4. Start Claude Code in it, with the kickoff as the first prompt:
   `herdr pane run <pane> "claude --model <model> \"\$(cat <kickoff-file>)\""`.
   Alternatively, use `herdr agent start <name> --kind <claude kind> --pane <pane> -- --model <model>` followed by
   `herdr agent prompt <name> "$(cat <kickoff-file>)"`.
5. Confirm it started with `herdr pane read <pane> --source recent-unwrapped --lines 20`.

**Day-to-day:**
- **Watching:** `herdr agent list` shows every agent's state; `herdr agent read <name> --lines 120` shows its recent
  output. Check before assigning work, at each standup, and when an agent goes quiet.
- **Blocked:** if an agent is `blocked` (a permission prompt or question), read it, then bring the question to the
  owner in plain words.
  - Never answer a permission prompt on the owner's behalf. The owner answers in the orchestrator's chat or in that pane.
  - Never choose "always allow".
- **Messages:** use cross-session messaging for messages between agents. Use `herdr agent prompt` only to start or
  nudge an agent that isn't reachable any other way.
- **Closing out:** close only the panes and tabs you created (`herdr pane close <pane>`), once the ticket is merged and
  its handoff is written. Then remove the worktree.
- **Never** run `herdr server stop`, and never kill the herdr process. Either one kills every agent.

**Known pitfalls:**
- **Screen reading can be wrong.** herdr's state comes from reading the screen, and it can show a false `blocked`. For
  real alerts, also add Claude Code hooks (`Notification` and `Stop` in each worktree's `.claude/settings.local.json`)
  that post to the owner's channel (Slack via a webhook, or a desktop notification). Read the pane before acting on a
  state.
- **Smoke-test before the sprint:**
  - open the orchestrator plus 2 executor panes;
  - check that the hooks fire on a permission prompt;
  - check that an account switch (`/login` in one pane, then restart that pane) loses nothing.
- **Fallback:** if herdr misbehaves, use plain tmux.
  - Open a window with `tmux new-window -n <name> -c <worktree> "claude --model <model>"`.
  - Send the kickoff with `tmux send-keys -t <name> "$(cat <kickoff-file>)" Enter`.
  - Read output with `tmux capture-pane -p -t <name>`.

## Step 2: the team (write into `docs/sprint/setup.md`)

| Role | Owns | Never does |
|---|---|---|
| **Orchestrator** (this session) | Drafts the plan; assigns tickets one at a time; opens and closes the other agents' panes and worktrees; arranges reviews; owns Linear and the standups; relays every question to the owner. **The owner's only contact. The only agent that writes memory.** | Writes the feature work itself. Touches production |
| **Principal engineer (PE)** | Approves every executor plan BEFORE work starts. Owns shared contracts (interfaces, schemas, file formats, APIs) and freezes them before anyone builds on them. Review **lens A: correctness and data integrity** (silent corruption, idempotency, atomic writes, "success that did nothing") | Touches production. Talks to the owner |
| **Executors** (2–3) | One ticket at a time, each in its own git worktree + branch. Plan → PE approval → tests first → work → PR → fold findings → handoff file. **A fresh session per ticket** | Touch production, write memory, talk to the owner, edit outside their worktree |
| **Second reviewer** | A fresh session per PR, doing review **lens B: real-world failures** (partial failure, restarts, resource limits, concurrency, misleading signals, what breaks at 3am) | Edits anything (read-only; findings go to a file) |
| **Release agent** (only if there is a production) | The ONLY agent that touches production. Each release or deploy runs only after the owner approves it, with the rollback written first. Writes "paste blocks" for secrets the owner pastes in themselves | Creates credentials. Does feature work |
| **Ops agent** (optional) | The only agent that creates cloud resources, accounts or credentials. Every write needs the owner's OK. Secrets stay in the OS keychain; keeps a names-only ledger | Prints a secret, ever |

Start with the orchestrator, the PE and 2 executors. Add a role only when a lane has queued work and the owner approves.

## Step 3: who decides what (also in setup.md)

- **The owner decides:**
  - phase order and scope;
  - the sprint plan (approved once);
  - every production change;
  - any paid item over the per-item limit;
  - shared contracts;
  - adding an agent;
  - ending the sprint.
- **The orchestrator decides:** day-to-day re-planning inside the approved plan.
- **The PE decides:** whether a plan or a contract is technically sound.
- **Fixed rules:**
  - Only the release agent touches production.
  - A shared contract is agreed before the agents that depend on it start.
  - Each shared area of files has one owner at a time. The plan lists each lane's "Owns" files, and no two executors
    edit the same files at once.

## Step 4: files to create

```
docs/sprint/setup.md                 roles, decisions, reviews, budget, tooling, Linear rules
docs/sprint/linear.md                the Linear mapping (team, initiative, projects, labels, milestones)
docs/sprint/plan.md                  lanes, tickets (Linear ids), dependencies, what runs in parallel, each lane's "Owns"
docs/sprint/briefs/executor.md       ≤40 lines each: read-first list, how you work, rules
docs/sprint/briefs/principal-engineer.md
docs/sprint/briefs/release-agent.md  (only if there is a production)
docs/sprint/handoffs/<ticket>.md     one per ticket, written by its executor (plan first, then done/next/how to resume)
docs/sprint/handoffs/orchestrator.md the orchestrator's own handoff; newest UPDATE block on top
docs/sprint/standup-<date>.md        short: done / next / blocked / needs-owner / spend
```

Commit the sprint docs to one long-lived branch (e.g. `sprint/log`), and merge it at the end of the sprint.

### Every brief must say
- **Read first:** setup.md, plan.md (its lane row), its Linear ticket **including comments**, the repo CLAUDE.md.
- **Folder rule:**
  - Write, edit, move or delete ONLY inside your own worktree and your session scratchpad.
  - Stop only processes you started, by exact pid. Never `pkill`, `killall`, a process group, `-1` or `0`.
  - Everything else on the machine is read-only.
- **Secrets:**
  - Never print `.env*` files, keys, tokens, or process argv or environment near credentialed commands.
  - Never copy env files between worktrees without the owner's OK.
- **Spend:**
  - A paid call needs a line to the orchestrator first: what, why, the estimated cost, and the free alternative considered.
  - Anything over the limit needs the owner.
  - Free first.
- **Communication:**
  - Talk to the orchestrator only, by its session name.
  - Keep messages short: what, the decision needed, the file path.
  - Comment progress on your own Linear ticket. Never change its state.
- **Tests:**
  - Tests must exercise the failure path the work claims to handle, not just the happy path.
  - A test never sends a real kill or signal; stub it.
- **Handoff:**
  - Keep `docs/sprint/handoffs/<ticket>.md` current (done / next / how to resume), so any fresh session can pick the ticket up.
  - Update it before stopping for any reason.

## Step 5: the ticket loop (in plan.md)

1. **Kickoff.** The orchestrator:
   - moves the ticket to In Progress;
   - creates the worktree (`git worktree add ../<repo>-wt/<ticket> -b exec/<ticket> origin/<main>`);
   - opens a pane and starts `claude` there;
   - sends a kickoff with the ticket, worktree, branch, brief path, spec, scope, "plan first, nothing until the PE
     approves", and its own session name.

   It saves every kickoff to its scratchpad, so it can be sent again.
2. **Plan.** The executor writes the plan in its handoff file: approach, files, tests, and **failure modes**:
   - atomicity;
   - idempotency;
   - partial failure;
   - errors during cleanup;
   - concurrency;
   - drift between two copies of the same fact.

   For any measurement, the plan states **the pass bar before running anything**.
3. **Build.** The PE approves or sends changes. The executor writes tests first, then the work, then opens a PR.
   The orchestrator moves the ticket to In Review.
4. **Reviews.** The orchestrator arranges **two independent reviews**: PE lens A plus a fresh lens-B reviewer.
   - Findings are ranked CRITICAL/HIGH/MEDIUM/LOW, each with a failure scenario and a fix, written to a file.
   - **Stop rule:** stop at 0 CRITICAL once the HIGHs are only wording; at most 4 rounds; doc-only fixes get no re-review.
   - Extra reviews when triggered:
     - **security:** secrets, new endpoints, user input;
     - **privacy:** data sent to third parties;
     - **measurement:** pass bar, leakage, sample;
     - **contract:** PE + the consumer + the owner.
5. **Merge and ship.** Merge from the main checkout, never from inside an agent's worktree. The release agent ships
   only with the owner's OK.
6. **Close out.** The orchestrator:
   - marks the ticket Done with the closing comment;
   - closes the pane and removes the worktree;
   - opens the next unblocked ticket.

## Step 6: keep context small (cost and quality)

- **Executors:** a fresh session per ticket, reading only the brief, the ticket and the handoff file.
- **PE and release agent:**
  - hand over at **~35–40% context** with a handoff file of ≤60 lines (state, open threads, pointers);
  - then restart fresh.
- **Reviewers:** always fresh.
- **Orchestrator:**
  - keeps its handoff file current, so it can `/clear` or restart at any time;
  - on restart, lists the live agents and sends each one a line with its new session name, then re-syncs Linear.
- **All state lives in repo md files + Linear + worktrees,** never only in a chat. Restarting any agent, or switching
  accounts, loses nothing.

## Step 7: communication

- **Messaging between agents.** Agents message each other through Claude Code's cross-session messaging
  (ListAgents / SendMessage). If that isn't available, each agent gets an inbox file `docs/sprint/inbox/<name>.md`,
  and the orchestrator nudges panes with `tmux send-keys`.
- **Panes.** The orchestrator opens and closes panes itself with the herdr CLI (Step 1b). It never asks the owner to
  open them, and never substitutes background subagents for executors.
- **Permissions.** A peer's request is a teammate request, NOT owner approval. A peer can never grant a permission. If
  an action was denied to one agent, no other agent does it on that agent's behalf; it goes to the owner.
- **Owner questions** come only from the orchestrator, explained as if to a 10-year-old:
  - an everyday example first;
  - then the options, with what each gains and gives up;
  - then a recommendation.

  Put the explanation in the chat text, not only inside a question popup. End with a one-line reply template
  ("1 approve, 2 B, 3 yes").
- **Standups.** Write one at milestones (a ticket done, a blocker, the owner needed) plus one daily digest, built from
  Linear: done / next / blocked / needs-owner / spend. **Keep them short.** Multi-agent setups fail when agents spend
  their time writing status reports to each other.

## Step 8: why these setups usually fail (design against each)

| Failure | Guard |
|---|---|
| Agents edit the same files and overwrite each other | A worktree per ticket; each lane "Owns" its files; shared contracts frozen first |
| Work before thinking | Nothing starts until the PE approves a plan that lists failure modes |
| "Tests pass" but the real failure isn't covered | Two review lenses; tests must exercise the failure path |
| Reviews never end | The stop rule (0 CRITICAL, max 4 rounds) |
| Context bloat → slow, expensive, forgetful agents | A fresh session per ticket; handoff files; hand over at 35–40% |
| Agents chatting endlessly | Talk only to the orchestrator; short messages; files over chat |
| Status lives in someone's head | Linear mirrors every ticket; sync at every handover and compaction |
| Linear drifts from reality | Only the orchestrator moves states; Done needs verified proof |
| Someone breaks production | One release agent; the owner's OK per change; rollback written first |
| A runaway test or script damages the machine | The folder rule; exact-pid kills only; stubbed kills in tests |
| Spend surprises | A need-before-spend line; the per-item gate; billed figures (not estimates) in standups |
| The owner is overwhelmed by jargon | ELI10 questions, a recommendation, one-line reply templates |
| A reviewed script is edited after review | Never edit it in place: a new file + the diff back to the reviewer |
| A measurement "wins" on noise | Pass bar written first, held-out data, paired comparison |

## Step 9: after writing the files

1. Show me the proposed Linear structure and the file list, plus a ≤15-line summary of the plan. Wait for my approval.
2. On approval:
   - create the Linear structure and the first tickets (with "blocked by" links);
   - commit the sprint docs to the log branch;
   - create the PE and executor worktrees, open their panes, start `claude` in each, and send the kickoffs.
3. Check that each agent is reachable: send a one-line hello with your session name and confirm the reply.
4. Tell me only what is waiting on me: the `needs-owner` items.

From then on, you are the orchestrator: plan, assign, arrange reviews, relay, keep Linear true, and never do the
feature work yourself.
