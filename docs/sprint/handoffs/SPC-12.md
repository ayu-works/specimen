# SPC-12 handoff: docs drift

## Plan (APPROVED by pe-5e, 2026-10-14, with 4 points: privacy URL = owner check; verify merged/green at PR time; CLAUDE.md pointer gives the `git show` command and keeps the two hard rules inline; 7.2 = non-blocking CI report)
Doc-only. Fix facts, keep sections that are still true. Files: `CLAUDE.md`, `docs/IMPLEMENTATION.md`,
`docs/PLAN.md`, `docs/HANDOFF.md` (+ this file). No comments on the ticket besides the description.

**CLAUDE.md**
- Replace §Workflow (the phase loop: Sonnet builds, tests deferred, "CI may be red") with a 3–4 line pointer:
  workflow = `docs/sprint/setup.md` (on branch `sprint/log` until the end of sprint 1), Linear mapping
  `docs/sprint/linear.md`, current work `docs/sprint/plan.md`; one line that `pnpm gate` must be green before
  review and tests ship with the code. Commands / Layout / Rules untouched.

**docs/IMPLEMENTATION.md**
- Phase 3/4/5 status lines: "tests deferred to the final testing pass" → keep as history, append "tests shipped in PR #9".
- Phase 6 status: 6.4 "submission on hold" → submitted; v1.0.0 live on the CWS 2026-10-13. Add: T6.07 gitleaks
  scan in the gate and CI (PR #18). Keep "MCP dropped from v1 (2026-10-09)"; add that T6.01–T6.05 go with it.
- Phase 7 intro + 7.2 row: Astro / `apps/web` / Vercel → plain HTML in `site/`, no build, Netlify from `main`
  (PRs #15–#17; Free plan, batch `site/` changes). 7.2 AC "Lighthouse ≥ 95" stays; note it is measured by SPC-11.
  Add a status line: T7.04 frame-count test (PR #20); T7.01/T7.03 in progress (SPC-8, PR #19, not merged).
- "How we work" (Sonnet builds, per-phase branches): one line pointing to `docs/sprint/setup.md` for the current
  workflow; the phase text stays as history. Header "Status: draft" → "Phases 0–7 shipped".
- Milestone checklist: tick all five. v0.1–v0.4 were never released separately (no git tags exist), so annotate:
  "no separate release; shipped in v1.0.0". v1.0.0: "live on the CWS 2026-10-13".

**docs/PLAN.md**
- §4 v1.0 line and §5 phase table rows 6–7: MCP bridge → "dropped from v1 (2026-10-09)"; `apps/web` → `site/`.
- §6 Website: "`apps/web` (Astro, static)" → "plain HTML in `site/` on Netlify". Video length question: answered
  (four cuts × three formats, `mix` approved, PR #11). Pricing table / open questions: untouched (product history).

**docs/HANDOFF.md**
- Date → 2026-10-14; "CLAUDE.md holds the workflow" → workflow lives in `docs/sprint/setup.md`.
- Done table: add #13 (CI), #14 (store listing), #15–#17 (website), #18 (gitleaks, T6.07), #20 (T7.04).
- Website line: drop "once the Netlify URL exists"; state the site is live on Netlify Free (each production deploy
  costs 15 of 300 credits/month; batch `site/` changes; non-`site/` merges are skipped by `netlify.toml`).
- `phase-6-mcp` bullet: launch happened; the decision is SPC-10 (owner backlog). CI note: CI is green.

**Check:** `rg -n "deferred|Astro|Vercel|may be red" CLAUDE.md docs/IMPLEMENTATION.md docs/PLAN.md docs/HANDOFF.md`
returns only historical mentions; `pnpm lint` (Biome ignores md, but run it anyway). PR body lists each fix + source.

**Failure modes / drift**
- Two copies of a fact: the workflow now lives only in setup.md; CLAUDE.md only points. Until sprint/log merges,
  the pointer names the branch, so it isn't a dead link in disguise.
- Don't claim what I can't verify: I don't know the live Netlify URL or whether the CWS listing's privacy URL was
  already switched to `/privacy` (store/SUBMIT.md still says "once the website is live"; `store/` isn't my lane).
  HANDOFF will say "confirm the listing's privacy URL is `<site>/privacy`" as an owner item, not claim it's done.
  **Question for PE/orchestrator:** is the privacy URL already switched? If yes I'll state it as done.
- SPC-8 is not merged: no doc claims T7.01/T7.03 done.
- No GitHub release exists (no `v*` tag): don't claim one.

## Done
- Edits applied to CLAUDE.md, docs/IMPLEMENTATION.md, docs/PLAN.md, docs/HANDOFF.md as planned, plus the PE's 4 points.
- Also dropped HANDOFF's "Opus plans and reviews; Sonnet builds" line (the team is now all Opus per setup.md).
- Verified at PR time: #9, #13–#18, #20 merged; #19 (SPC-8) open; CI on main green (run 38573173204, 2026-10-14).
- Check: the rg command returns only the three Phase 3–5 "tests deferred …, which shipped in PR #9" history lines. `pnpm lint` clean.

- Lens A r1 (0C/1H/2M/2L) folded in: H1 owner-merge rule, M1 Netlify batching rule, M2 Commands, L1 HANDOFF video job, L2 Phase 3.8 superseded.

## Next
- PR #21 open, Linear comment posted, specimen-b0 told. pe-5e is reviewing the PR itself (doc-only skips lens B, not the PE review). r1 folded; doc-only fixes get no re-review. Waiting for the owner's merge.

## How to resume
- Branch `exec/spc-12`; read this file and the PR.
