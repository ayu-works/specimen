# Sprint 1 summary (2026-10-14 to 2026-10-15)

**Goal met:** `pnpm check-ids --all` covers phases 0–7 (92 required IDs; T6.01–T6.05 dropped ⊘), `pnpm gate` and CI
are green on `main` (1150d70), and the failure-path audit's HIGHs are filed.

| Ticket | What | PR | Merged |
|---|---|---|---|
| SPC-5 | Team smoke test (herdr panes, messaging, desktop alerts) | | 2026-10-14 |
| SPC-6 | T6.07 gitleaks scan of the whole history | #18 | 7fbadc2 |
| SPC-7 | T7.04 Remotion composition frame counts | #20 | 31fa181 |
| SPC-8 + SPC-15 | T7.01/T7.03 website e2e; 375px fallback-font overflow fix | #19 | bbc8854 |
| SPC-11 | T7.02 Lighthouse report; self-hosted fonts, CSP (100 in all four) | #22 → #19 | bbc8854 |
| SPC-12 | Docs drift (CLAUDE.md workflow, IMPLEMENTATION, HANDOFF) | #21 | 78c07f6 |
| SPC-13 | Failure-path audit: 0 CRITICAL / 13 HIGH / 21 MEDIUM / 12 LOW | (sprint/log) | a8211ee |
| SPC-14 | check-ids phases 0–7, ⊘ dropped format | #23 | 1150d70 |

**Production:** no CWS release (the owner decided not yet). **Netlify:** 1 production deploy (15 of 300 credits), with all
site changes batched into #19. **Paid API spend:** $0.

**Backlog the owner owns:** SPC-16 to SPC-21 (real extension bugs from the audit; they need a v1.0.1 release), SPC-22
(critique-panel spike with Groq, next), SPC-23 (/fonts Cache-Control, batch with the next site change), SPC-9 (manual
checks + the CWS privacy URL), SPC-10 (MCP future).

**Process lessons**
- Reviews earned their keep: lens B found real "success that did nothing" bugs (a gitleaks git failure read as clean;
  T7.03 vacuous under overflow:hidden; malformed TESTING.md rows skipped).
- Held/stacked PRs go stale while main moves: check `mergeStateStatus` before waiting on CI (a conflicted PR runs no
  Actions).
- Close a pane only after `herdr agent wait --until idle`. Session names change on restart: re-read ListAgents.
- The orchestrator must not re-decide an owner's choice (the CSP 'self' detour): relay technical pushback to the owner.
- Batch `site/` changes (Netlify Free).
