# Sprint 1 plan: close the test gaps

Approved by the owner on 2026-10-14. **Done when:** `pnpm gate` is green with `pnpm check-ids --all` covering phases
0–7 (the dropped MCP IDs marked as dropped), CI is green on `main`, and the failure-path audit's CRITICAL/HIGH findings
are filed as tickets.

Context: the deferred testing pass already shipped (PR #9: 87/87 IDs for phases 0–5). v1.0.0 is live on the Chrome
Web Store (2026-10-13); the site and the video are done. This sprint only changes tests, CI and docs, so it needs
**no CWS release**.

## Lanes
| Lane | Owns (only this lane edits these) | Tickets, in order |
|---|---|---|
| **A** | `scripts/`, `.github/workflows/`, `docs/TESTING.md`, `apps/video/` (tests and config only, never renders or audio), root `package.json` scripts | SPC-6 → SPC-7 → SPC-14 |
| **B** | website tests and their config (a new folder, e.g. `site-tests/` or `apps/extension/e2e/site/`, agreed in SPC-8's plan), `docs/IMPLEMENTATION.md`, `docs/PLAN.md`, `docs/HANDOFF.md`, `CLAUDE.md`; `site/` only for SPC-15's overflow fix | SPC-8 (+ SPC-15) → SPC-11 → SPC-12 |
| **PE** | `docs/sprint/reviews/` (findings only) | SPC-13, between reviews |
| **Orchestrator** | `docs/sprint/*` on `sprint/log`, Linear | SPC-5 first |
| **Owner** | | SPC-9 (manual checks), SPC-10 (MCP decision, backlog) |

A ticket that needs a file another lane owns (e.g. SPC-11 needs a CI job) asks the orchestrator, which sequences it
behind the owning lane's open ticket ("blocked by" in Linear).

## Tickets
| Ticket | What | Blocked by | Reviews |
|---|---|---|---|
| SPC-5 | Team smoke test (2 test panes, alert hooks, account switch) | | none (orchestrator) |
| SPC-6 | T6.07 gitleaks scan of the whole history in CI + locally | | PE + lens B + security |
| SPC-7 | T7.04 Remotion compositions: frame count = fps × duration (video CI job) | | PE + lens B |
| SPC-8 | T7.01 + T7.03 website e2e: links, CTAs, 375px no horizontal scroll | | PE + lens B |
| SPC-11 | T7.02 Lighthouse report, a non-blocking CI job | SPC-6, SPC-8 | PE + lens B + measurement |
| SPC-15 | Bug: `/privacy` scrolls sideways at 375px with fallback fonts (found by SPC-8). **Ships in SPC-8's PR.** `site/` is live on merge | | with SPC-8 |
| SPC-12 | Docs drift (CLAUDE.md workflow → pointer to `docs/sprint/`; IMPLEMENTATION.md Phase 7; HANDOFF.md) | SPC-8 | PE only (doc-only) |
| SPC-14 | check-ids covers phases 0–7; mark T6.01–T6.05 dropped in TESTING.md | SPC-6, SPC-7, SPC-8, SPC-11 | PE + lens B + contract (owner OKs the TESTING.md format) |
| SPC-13 | Failure-path audit of the existing suites (read-only findings) | | orchestrator reads; files tickets |

**Runs in parallel:** after SPC-5, lane A starts SPC-6 and lane B starts SPC-8 at the same time. The PE reviews plans
and PRs as they come, and works on SPC-13 when idle.

## Backlog (not in this sprint; the owner picks)
- Expose the existing token exports (Tailwind, CSS vars, shadcn, DTCG, Figma) in the side panel.
- Re-capture the `fixtures/raw/*` real sites and measure extraction accuracy against them (a `measurement` ticket).
- The MCP bridge's future (SPC-10).
- A v1.0.1 CWS release, once something user-facing changes.
