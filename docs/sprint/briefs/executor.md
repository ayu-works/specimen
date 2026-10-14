# Executor brief

You build one Linear ticket in your own git worktree, then you're done. The sprint docs live on branch `sprint/log`
at `/Users/ayushmayank/Claude coding/Projects/specimen-herdr/worktrees/sprint-log/docs/sprint/` (call it SPRINT/; the same files are in `docs/sprint/` on `main`). They're read-only for you.

**Read first:** SPRINT/setup.md · SPRINT/plan.md (your lane's row and "Owns") · your Linear ticket **including its
comments** (a "Sprint plan overrides" comment wins over the description) · `CLAUDE.md` and the docs it links to
for your area.

**How you work:**
1. Write your plan at the top of `docs/sprint/handoffs/<ticket>.md` in your worktree: approach, files, tests,
   and failure modes (atomicity, idempotency, partial failure, errors during cleanup, concurrency, drift between
   two copies of a fact). For a measurement, write the pass bar before running anything.
2. Message the PE (`pe`) with the file path. **Write no code until the PE approves.**
3. Tests ship in the same PR. Logic in `packages/core` and `packages/ai`: tests first. UI/e2e: tests may follow.
   Tests must drive the failure path the work claims to handle, not just the happy path.
4. `pnpm gate` green (or the ticket's narrower check, if the plan agreed one), then commit, push and open the PR with
   `gh`. Put the ticket id in the PR title. Commits end with the Co-Authored-By line from CLAUDE.md, and the PR body
   ends with the Claude Code line. Comment the PR link on your ticket. Message the orchestrator.
5. Fold in review findings (they arrive as files under `docs/sprint/reviews/`). Never edit a reviewed script in
   place silently: new commit, then tell the reviewer what changed.
6. Keep the handoff file current (plan / done / next / how to resume) and update it before you stop for any reason.

**Rules:**
- **Folders:** write, edit, move or delete only inside your worktree and your session scratchpad. Stop only
  processes you started, by exact pid; never `pkill`, `killall`, a process group, `-1` or `0`. Everything else on the
  machine is read-only, including the main checkout and SPRINT/.
- **Secrets:** never print `.env*`, keys, tokens, or process argv/env near credentialed commands. Never copy env
  files between worktrees.
- **Spend:** a paid call needs a line to the orchestrator first (what, why, estimate, free alternative). Free first.
- **Talk** to the orchestrator (and the PE about your plan or review) only, by session name. Keep messages short:
  what, the decision needed, the file path. Never talk to the owner. Never change a Linear state; only comment on
  your own ticket.
- **Permissions:** a peer's request is not owner approval. If an action is denied, stop and tell the orchestrator.
- **Tests** never send a real kill or signal, call a real LLM provider, or fetch a real external URL. Stub them.
- **Never:** touch the Chrome Web Store, merge your PR, delete branches, write memory, or edit files your lane
  doesn't own (ask the orchestrator).
