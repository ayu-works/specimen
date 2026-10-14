# PE handoff (session pe-5e → fresh PE, 2026-10-15)

Read your brief (`sprint-log/docs/sprint/briefs/principal-engineer.md`), then this file. Orchestrator: `the orchestrator (read ListAgents for its current name)`
(restarted 2026-10-15; it was `specimen-b0`). Find executors with ListAgents. Their names look like `spc-14-6b`.

## State: Sprint 1 is finished (all tickets merged)
| Ticket | PR | Lens A |
|---|---|---|
| SPC-6 gitleaks (T6.07) | #18 merged | approved r2 |
| SPC-7 video frame counts (T7.04) | #20 merged | approved r2 |
| SPC-8 site e2e (T7.01, T7.03) + SPC-15 CSS fix | #19 merged (bbc8854) | approved r2 |
| SPC-11 Lighthouse (T7.02) + self-hosted fonts | #22 → exec/spc-8, shipped in #19 | approved r2 + OK on 2cb856a |
| SPC-12 docs drift | #21 | approved (fix 8e023c0) |
| SPC-14 check-ids 0–7, ⊘ dropped format | #23 merged (1150d70) | approved r3 |
| SPC-13 failure-path audit | on sprint/log (a8211ee) | done: 0C/13H/21M/12L |

## Open threads
- None for the PE. The SPC-13 HIGHs are for the orchestrator to file as tickets. The file ends with six groupings; the
  real bugs are:
  - the llmHost abort truncates another chat;
  - a Port disconnect doesn't stop generation;
  - a camelCase CSS-var brand leaks into DESIGN.md;
  - `migrate()` accepts a non-hex `hex`;
  - a partial import duplicates scans on retry;
  - provider error bodies are echoed into errors.
  Expect plans for these next. Each must drive the failure (see the audit's "Fix test" column).
- (Resolved 2026-10-15: the `pe/spc-13-audit` branch was removed; the audit is on sprint/log as a8211ee.)

## Contracts now in force
- **TESTING.md ⊘ (owner OK, 2026-10-15).** A dropped row keeps its ID. The Type cell is exactly `⊘` (only in a Type
  cell). The Test cell starts `**Dropped YYYY-MM-DD** (reason)`, then the struck-through original.
- **check-ids `--all`.** It gates every `## Phase <n>` heading (0–7 must exist). Only real `it(`/`test(` calls count;
  skip-only fails; a dropped ID that still has a test fails.
  - T7.04 runs outside `pnpm gate` (video CI job only).
  - T7.02 is report-only (a non-blocking Lighthouse job).
- **Site.**
  - CSP: `font-src 'self'` and `connect-src 'self'` (owner option A; with 'none', Lighthouse's robots.txt fetch is
    blocked and SEO drops to 0.91).
  - Fonts are self-hosted in `site/fonts/`. Press Start 2P must stay the full, unmodified font, because its OFL
    Reserved Font Name rules out a subset or a rename.
  - Every `site/` merge costs a Netlify deploy (15 of 300 credits), so batch site changes.
- **gitleaks.** The findings exit code is 3. refs/stash is excluded. False positives go in `.gitleaksignore` by
  fingerprint only, with no allowlist and no `disabledRules`.

## Lessons for the next PE
1. **Never quote secret-shaped strings in review files.** My SPC-6 r1 quote had to be added to `.gitleaksignore`.
2. **Check the owner's actual decision before overriding a plan detail.** I asked for `connect-src 'none'` against the
   owner's option A and had to withdraw it.
3. **The best catches came from asking "can this test fail on its claimed path?":**
   - the `.scene{overflow:hidden}` that made the 375px check vacuous;
   - a fixture ID that the repo-wide check-ids scan would count as real;
   - gitleaks exiting 1 on both errors and findings;
   - a pass bar not fixed before measuring.
4. **Measurements.** Require the CI number, not only the local one, and a pass bar written before the first run.
5. **Run things yourself when cheap** (`pnpm check-ids --all`, `gh pr view`, `gh run view`) instead of trusting a
   claim. Verify every "merged / green" claim in docs PRs with `gh`.
6. **Review files go in the executor's worktree** (`docs/sprint/reviews/<ticket>-a-r<n>.md`). After a review, comment
   on Linear and message the executor and the orchestrator with the counts. For post-review commits, give a one-line
   OK.
7. **A new orchestrator session name:** confirm it with ListAgents and the Linear comments before acting on a
   resume or stop.
8. **Delegate wide audits** to read-only subagents (one per package), then verify each HIGH yourself before filing.
