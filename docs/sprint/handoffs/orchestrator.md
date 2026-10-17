# Orchestrator handoff

**Resume this orchestrator:** in the main checkout (`specimen-herdr/specimen` since 2026-10-15; formerly `Specimen`), run `claude --resume 015cf71f-2911-4db4-8f1b-44b3361da55e`
(or `claude --continue`). The session may be listed as "Handoff document". The `/resume` list is per folder.

Newest UPDATE block on top. A fresh orchestrator session reads this, then `docs/sprint/setup.md`, `plan.md`,
`linear.md`. The template these came from is `docs/sprint/setup-prompt.md`.

## UPDATE 2026-10-17 ~15:25 (CURRENT STATE)

- Orchestrator specimen-75 (w1:p3); PE **pe-b2** (w1:pS); keeper sprint-log-50 (w1:p1R, tab keeper). Owner rules for THIS RUN: 3 at a time, no merges until one "merge all", go with the recommended option (record it in Linear and in merge-report.md). Reports: docs/sprint/merge-report.md (merge checklist), docs/sprint/reports/{sprint-report,linear-report}.md. Keep all of them short and plain.
- **READY (both lenses + CI):** #39 SPC-28 (base main), #40 SPC-21, #41 SPC-29, #42 SPC-37 (head docs commit 306017f after the approval at a6feb5b).
- **In review:** #43 SPC-44 (base exec/spc-28; spc-44-4d w1:p1V; lens A approved with an optional LOW; lens B r1 1M/3L being folded. M1 = check the xvfb popup width in the CI log). #44 SPC-40 (spc-40-3c w1:p1Z; lens A approved; lens B r1 2M/3L being folded). Both then go to pe-b2 for a fold check.
- **Building:** SPC-38 (spc-38-63 w1:p22, stacked on exec/spc-44, PR base exec/spc-44, plan approved). SPC-41 (w1:p23, from main, just started).
- Panes closed: the spc-28, spc-29 and spc-37 executors and all reviewers. spc-21 (w1:p1N) is idle. Worktrees are kept for the merge-all rebases.
- **Merge order at the end:** #39 → #43 → SPC-38's PR (stack; retarget each to main as its base merges, or merge with the base chain), then #40, #41, #42, #44, the rest. Rebase each on main; TESTING.md rows conflict (additive). `--match-head-commit`. Check main CI after each. Then Linear Done + closing comments.
- Queue after SPC-41: SPC-42 → 43 → 45 (stack on #39: scanFlow.ts) → 30 → 31 → 36 → 27 → 23 (site; + privacy page debugger line) → 10 (PE recommends). SPC-9 is the owner's.
- Linear: Product label group (Specimen) on all issues/projects; projects renamed "Specimen: …". The owner still renames the team to Build (keep SPC) and creates Growth.

## UPDATE 2026-10-17 ~14:40

- **Orchestrator is now specimen-75** (pane w1:p3, session 9a801fc2-f35e-4093-af49-48aab6a38438; kickoffs in its scratchpad). PE **pe-b2** (w1:pS; pe-4d restarted at 30% by the orchestrator, ~14:50).
- **Running (build tab w1:tX), all from origin/main b01ea77, In Progress in Linear:** spc-28-10 (w1:p1M, SPC-28 waitForTabLoad race, lane A, scanFlow.ts; stubs chrome.tabs locally), spc-21-6e (w1:p1N, SPC-21 deny-capable stubs, lane B, Owns test/helpers/chrome.ts + wxt e2e config; PE agrees the stub design), spc-29-68 (w1:p1P, SPC-29 T3.33 flake, lane C, Owns council.test.tsx). Worktrees worktrees/spc-28|21|29, branches exec/<ticket>.
- **Keeper** sprint-log-50 (pane w1:p1R, own tab `keeper` w1:tY, Haiku): at 30% context (≈300k tokens on a 1M window; check with jq over the session transcript's last usage), save this handoff, then SendMessage the keeper "restart w1:p3 /Users/ayushmayank/Claude coding/Projects/specimen-herdr/worktrees/sprint-log/docs/sprint/kickoffs/orchestrator.md". After a restart, message the keeper first so it knows the new name.
- **Owner (~14:50): "work on all the PRs, run 3 at a time, do not wait for me, we will merge at the end for all."** Run the whole queue without asking: reviews (PE lens A + fresh lens B), folds, gate. **No merges until the owner's final "merge all".** Ready PRs pile up. A new ticket that touches files of an open, unmerged PR is stacked on that branch (PR base = that branch), or waits. At the end, merge in dependency order with `--match-head-commit`, rebasing as needed; watch TESTING.md for duplicate IDs.
- **~15:05:** #39 + #40 READY (both lenses, CI green). #41 SPC-29 (spc-29-68, w1:p1P): lens A approved, lens B running (w1:p1X). Started: spc-44 (w1:p1V, stacked on exec/spc-28, PR base exec/spc-28), spc-37 (w1:p1W, from main). The spc-28 pane is closed (worktree kept); spc-21 pane w1:p1N idle. Owner's test copy ~/Desktop/specimen-critique-test rebuilt from main b01ea77 (worktrees/test-build).
- (older) **#39 SPC-28:** lens A approved; lens B r1 0C/0H/2M/3L (reviewer pane closed), spc-28-10 folding → pe-b2 fold check. **SPC-44** (new, High: debugger can't be optional; PE ruling B = remove debugger; contract → waiting on the owner's "OK 44 B"; stack after #39 + SPC-21). **SPC-45** (new, Low: rescanUrl tab leak; stack on #39). spc-21-6e Owns backgroundScan.ts too; spc-28-10 Owns captureFlow.ts.
- **Owner (~14:52): "from now on go with the recommended" — THIS RUN ONLY (until this run's "merge all"; later runs ask again).** For contract/owner decisions, apply the PE's or orchestrator's recommended option without asking, note "owner standing OK (recommended), 2026-10-17" on the ticket, and list every such call for the owner at the final "merge all". Merges still wait for "merge all". SPC-44 B OK'd (Todo; High, so it goes next, stacked on #39 + SPC-21).
- **Owner: a written, human-readable report when the PRs are ready to merge**: per PR, what it fixes for a user in plain words; every decision taken under the standing OK, with its trade-off; known risks and follow-ups; SPC-9 manual-check steps; the merge order. Keep `docs/sprint/merge-report.md` (sprint/log) up to date as each PR becomes ready.
- **Owner: "complete solving all the issues."** Queue (3 at a time): SPC-44 → 38 → 37 → 40 → 41 → 42 → 43 → 45 → 30 → 31 → 36 → 27 → 23 (site/; unheld since merge-all = one deploy) → 10 (PE recommends, then act). SPC-9 stays the owner's (give steps at the end).

## UPDATE 2026-10-17 ~14:35

- **Merged today (8, the owner said merge each):** #31 SPC-18, #32 SPC-32, #33 SPC-19 (DesignScan v5), #34 SPC-35, #35 SPC-33, #36 SPC-34 (truncated contract), #37 SPC-20 (css.fetch skipped contract), #38 SPC-39 (visible Library delete, owner-reported). Main b01ea77, CI green. All Done in Linear.
- **No executors running.** PE **pe-4d** (w1:pS) idle. Orchestrator specimen-6a at ~33% context: restart fresh before starting the next batch.
- **Next by priority (3 at a time):** SPC-28 (waitForTabLoad race, scanFlow.ts), SPC-21 (deny-capable chrome stubs; SPC-20 is merged, so it's unblocked), SPC-29 (T3.33 flake). Then the Lows: SPC-38 (stale card under a failed scan), SPC-37, SPC-40, SPC-41 (BYOK truncation), SPC-42, SPC-43, SPC-30, SPC-31, SPC-36, SPC-27. SPC-23 held (Netlify). Owner items: SPC-9 (manual checks, incl. a dense-page Gemma Council), SPC-10.
- Kickoff template: copy the latest one in the scratchpad pattern (ticket, worktree, branch from origin/main, orchestrator + PE names, notes, then brief → setup → plan → Linear → pnpm i → plan → PE → build → gate → PR). Lens B kickoffs: a fresh reviewer per PR in a new `review` tab; close the pane after `herdr agent wait`.
- Rules that held today: the PE fold check covers a lens-B HIGH re-check (no r2); hold pushes before a merge; merge with `--match-head-commit`; check the combined TESTING.md for duplicate IDs when two PRs merge together.

## UPDATE 2026-10-17 ~13:55

- Merged today (owner said merge each): #31 SPC-18, #32 SPC-32, #34 SPC-35, #33 SPC-19 (DesignScan v5). Main de35272, CI green. All Done in Linear.
- Running (build tab w1:tP): **spc-33-4f** (w1:p1C, SPC-33, PR #35 in review: pe-8a lens A + lens B pane w1:p1D), **SPC-20** (w1:p1E, lane B, planning), **SPC-34** (w1:p1F, lane C, planning; a protocol CONTRACT → PE ruling → owner OK before building). PE **pe-8a** (w1:pS).
- Next by priority when a slot frees: SPC-28 (after SPC-20, both in scanFlow.ts) → SPC-21 (shared chrome stub; NOT while SPC-20 is open, both touch test/helpers/chrome.ts) → SPC-29 → SPC-37 → SPC-30 → SPC-31 → SPC-36 → SPC-27. SPC-23 held (Netlify).
- Owner prefs today: "be faster, and prioritize"; short updates; only the owner says merge ("merge all" = every PR I'd presented as ready).
- Lesson: never chain pane/worktree cleanup after `gh pr merge` with `;`, because a refused merge still ran the cleanup (no loss: the branch was on GitHub). Use `&&`, or clean up separately.

## UPDATE 2026-10-17 ~13:45

- PE is now **pe-8a** (w1:pS; pe-ed handed over at its context limit, pe.md 7772a06). Orchestrator specimen-6a.
- **#31 SPC-18 MERGED** 11074ac (the owner said merge), Done; spc-18 pane/worktree removed. Follow-ups filed: SPC-34 (finish_reason 'length', contract), SPC-35 (crash during load), SPC-36 (\| in cells).
- **#32 SPC-32** (spc-32-6d, w1:p14): lens A approved; lens B r1 folded (dc682a8); the PE found a mid-title brand leak (M2) → fold in progress (cap 32 + segment tokens). Then pe-8a checks it → owner.
- **#33 SPC-19** (spc-19-02, w1:p16): DesignScan v5 (owner OK'd); lens A approved incl. the fold 0851801; lens B reviewer running (w1:p19, tab review).
- **SPC-35** (spc-35-d6, w1:p1A, lane B): plan waiting on pe-8a.
- Why SPC-35 was picked next: SPC-20 and SPC-28 touch scanFlow.ts (held by #33); SPC-21 runs last.

## UPDATE 2026-10-17 13:10

- **Orchestrator `specimen-6a`** (pane w1:p3); **PE `pe-ed`** (w1:pS). Build tab w1:tP: **spc-32-6d** (w1:p14, lane A), **spc-18-80** (w1:p15, lane B), **spc-19-02** (w1:p16, lane C). Worktrees worktrees/spc-32|18|19, branches exec/<ticket> from 77ac925. Kickoffs in this session's scratchpad (kickoff-spc-*.md). All three are In Progress in Linear.
- Routing: L2's DESIGN.md backtick escape (designmd.ts cell()) → SPC-32; import-side filter → SPC-19. SPC-19 M2 bounds = contract: the PE sends one ruling (draft: v5 bump + bounds table + trim-on-upgrade), then the **owner's OK is needed** before that part is built.
- Reviews: PE lens A on each; fresh lens B on each (security for 32 and 18).

## UPDATE 2026-10-17

- **Owner (2026-10-17): resume Sprint 3 by priority, three bugs at a time** (3 executors; owner-approved). First three: SPC-32 (lane A), SPC-18 (lane B), SPC-19 (lane C). Lanes, Owns and the next-in-line order are in plan.md "Resume 2026-10-17".
- The owner asked to restart the PE and the orchestrator to pick up a Claude Code update. pe-99 was exited and a fresh PE **pe-ed** runs in pane w1:pS on Claude Code 2.1.302 (launched from `docs/sprint/kickoffs/pe.md`).
- **On restart:** ListAgents → send the PE your name. Then kick off the three executors (template: an executor kickoff names the ticket, worktree, branch exec/<ticket> from origin/main, orchestrator + PE session names, ticket-specific notes, then brief → setup → plan → Linear with all comments → `pnpm i` → plan in handoffs/<ticket>.md → PE approval → build → gate → PR). All three panes go in a new `build` tab (the old one closed when it emptied). Move SPC-32/18/19 → In Progress.
- Ticket notes: SPC-32: fail closed on any sanitizer error (never fall back to raw text), cap/caching, a perf budget in the plan; security review on the PR. SPC-18: keep `attachLlmPort` behaviour, council tests green; security review. SPC-19: the M2 bounds are a contract (PE ruling → owner OK before building that part); L3 = store the parsed value in db.ts writers; keep `await chatsReady` and `DesignScanSchema.parse`.
- Main is 77ac925 (#30), CI green. No open PRs. No live executors.

## UPDATE 2026-10-15 ~23:00

- **Sprint 3 paused after SPC-26** (owner). #30 merged 77ac925; SPC-26 Done. spc-26 pane, worktree and branch removed. pe-99 standing by (pe.md copied here).
- Next on resume: SPC-32 (lane A, ahead of SPC-18), then SPC-18 → SPC-21; lane B SPC-19 (incl. sec M2/L1–L3; M2 bounds = contract, owner OK) → SPC-20 → SPC-28 → SPC-27.

## UPDATE 2026-10-15 ~22:20

- **Orchestrator session is now `specimen-c8`** (pane w1:p3); all live agents told.
- **Owner (22:35): stop after SPC-26 is done.** Do NOT start SPC-32 or anything else. #30 at ef29d3e (folds + T3.33 flake fix), CI running; pe-99 doing a final lens-A check (db.ts, M1 fold, ef29d3e) that also covers the M1 re-check. Then the owner's "merge 30" → close out SPC-26, then pause: agents save handoffs, panes stay open or get closed per the owner.
- 22:25: SPC-17 sec review done (1H/2M/3L, reviews/SPC-17-sec-r1.md). spc-17 panes + worktree + local branch removed. New **SPC-32** (H1+M1: long title freeze / sanitizer throw → fail closed), lane A, proposed ahead of SPC-18 (owner can reply "18 first"). M2+L1–L3 folded into SPC-19 via an overrides comment; M2's schema bounds = contract (PE + owner OK).
- SPC-17 **Done** in Linear (main CI green on df0297c, closing comment added). Post-merge security review still running: session spc-17-82, pane w1:p13 (tab review) → SPC-17-sec-r1.md. spc-17-13 (w1:pZ) idle; close it + the spc-17 worktree after the sec review finishes, then kick off SPC-18.
- #30 SPC-26: lens B r1 in (0C/0H/1M/6L, SPC-26-b-r1.md); reviewer pane p12 already closed. spc-26-81 is folding. GitHub says CLEAN + CI green, but after the fold the PE must confirm db.ts keeps SPC-17's write validation (rebase rule below) before the owner's merge.

## UPDATE 2026-10-15 ~22:15

**Sprint 3 (backlog) in progress.** Plan: `docs/sprint/plan.md`. No CWS release (owner). Netlify: 1 deploy this month.

Merged & Done today: #26 SPC-24 Council v2 (behind Labs), #28 SPC-16 key-safe errors, #27 SPC-25 fullscreen scan.

**Open PRs (merge only on the owner's explicit "merge N"; check CI green + mergeStateStatus first):**
- **#29 SPC-17: MERGED df0297c** (the owner said merge 29). **To do:** confirm main CI green → SPC-17 Done (closing comment). A **post-merge security review** is running (pane w1:p13, file worktrees/spc-17/docs/sprint/reviews/SPC-17-sec-r1.md; ReDoS, hostile imports); findings become fix-forward tickets. The plan named a security pass for SPC-17 and the pre-merge lens B covered data safety only, which is a process slip. Then start lane A's next ticket (SPC-18) with a fresh executor and close the spc-17 pane/worktree.
- (old) #29 SPC-17 (lane A): sanitizer camelCase + DesignScan **v4** (owner OK'd v4). Lens A r1 approved; lens B r1 (2H/2M/3L) folded in fc69291. **pe-99 r2 APPROVED fc69291 (0 findings).** Ready for the owner's merge once CI is green. Rebase rule for the second of #29/#30: db.ts must keep `DesignScanSchema.parse` in saveScan/updateScan/replaceStoredScan/saveCompose AND `await chatsReady` in loadChat/saveChat; gate green.
- **#30 SPC-26** (lane B): panel restore + one-time history scrub (knownKeys). Lens A r1 approved (1 LOW). **Waiting: lens-B + privacy reviewer (pane w1:p12, tab "review").** Close that pane only after `herdr agent wait --until idle`.
- ⚠️ #29 and #30 both touch `apps/extension/src/lib/db.ts`: the second to merge must rebase on main, keeping both the write validation (SPC-17) and the scrub (SPC-26). The PE checks.

**Live agents (session names change on restart; re-read ListAgents):** pe-99 (w1:pS, worktrees/pe), spc-17-13 (w1:pZ, worktrees/spc-17), spc-26-81 (w1:p0, worktrees/spc-26), reviewer for #30 (w1:p12). Tabs: control (orchestrator + PE), build (executors), review.

**Queue after merges:** lane A → SPC-18 (Gemma abort/disconnect, llmHost) → SPC-21 (deny-capable stubs). Lane B → SPC-19 (import atomicity, silent save fail; the validate-on-write part is already done in #29) → SPC-20 (scan failure paths) → SPC-28 (waitForTabLoad race) → SPC-27 (Inspect Port hardening). Backlog: SPC-29 (T3.33 flake), SPC-30 (insufficient_quota), SPC-31 (Unicode brand folding), SPC-23 (site, held: a Netlify deploy), SPC-9/SPC-10 (owner).

**Owner prefs (also in memory):** plain language, short updates, one-line reply templates; only the owner says merge; batch `site/` (Netlify Free); test copies of branch builds go to ~/Desktop/specimen-critique-test (load unpacked; separate storage from the store copy; Groq key + Labs flag already set there).

**Rules learned:** the orchestrator restarts itself at ~40% context (like the PE); the PE sends ONE contract ruling; executors all in the `build` tab; read main with `git show origin/main:<path>`, never pull in another checkout; verify with `herdr agent wait` before closing panes.

## UPDATE 2026-10-15 (Sprint 3 in progress)

- Merged today in Sprint 3: #26 Council v2 (986317e), #28 SPC-16 key-safe errors (8db2562), #27 SPC-25 fullscreen (d279592); all have main CI green and are Done in Linear.
- The owner OK'd the DesignScan **v4** contract for SPC-17 (strict hex plus role refs; v1–v3 repaired on read; a broken v4 is rejected/skipped).
- Live: pe-99 (w1:pS), spc-17-13 (w1:pZ, lane A, building Part 2 v4), spc-26-81 (w1:p0, lane B, planning; includes the one-time history scrub with knownKeys). Both executors are in the `build` tab (w1:tG).
- Queue: lane A → SPC-18 → SPC-21; lane B → SPC-19 → SPC-20 → SPC-28 → SPC-27. Backlog: SPC-29 (T3.33 flake), SPC-30 (insufficient_quota), SPC-23 (site, held for the deploy budget), SPC-9/10 (owner).
- No CWS release (owner). Netlify: 1 deploy this month.

## UPDATE 2026-10-15 (SPC-24 approved, waiting for the owner's test)

- PR #26 (Council v2): pe-99 r2 APPROVED 0/0/0/0 on 3c3faaa (covers the lens-B folds); CI gate green on 3c3faaa; bf143c9 is docs only. The owner OK'd the v1 amendments (resolvedAt, summaryText, snapshot last-finished-run). **Do not merge before the owner's go.** On go: merge #26 (behind Labs; no CWS release), close #25 as superseded, then SPC-26 (state restore) and SPC-27 unblock.
- Owner test copy: ~/Desktop/specimen-critique-test rebuilt from 3c3faaa (build worktree: worktrees/test-build, detached; remove it after the decision).
- New tickets: SPC-25 (fullscreen scan opens a new tab: mobile-capture popup; in the published extension too; can run in parallel), SPC-26 (restore panel state on reopen; blocked by SPC-24), SPC-27 (Inspect onConnect hardening, low).
- Live: pe-99 (w1:pS), spc-24-3e (w1:pR, idle, done). The second executor slot is free; the owner hasn't answered "start 25".
- Process lesson: when the PE and executor both message about a contract, they crossed twice. Rule: the PE sends ONE final contract ruling to both the orchestrator and the executor.

## UPDATE 2026-10-15 (owner tested SPC-22: GO with a redesign → SPC-24)

- Owner feedback: the live chat was hard to read. Wants: Ask + Council merged; a context box; a background run even with the panel closed; mascot status, click to reopen; a verdict-only report, no prompt; "show discussion" collapsed by default.
- SPC-22 Done (spike); #25 stays unmerged (superseded). SPC-24 started: spc-24 executor (w1:pR, worktree worktrees/spc-24, branch exec/spc-24 from origin/exec/spc-22); pe-1b decides the background architecture.
- The owner's test build of the spike is on ~/Desktop/specimen-critique-test (loaded unpacked). Lesson: tell the owner the test copy has separate storage from the store version (Labs/key must be set in the test copy's Options; disable the store copy).

## UPDATE 2026-10-15 (Sprint 2: SPC-22 waiting for the owner's test)

- #24 merged (e1e8a6e): Sprint 1 is closed. Sprint 2 = SPC-22 (critique-panel spike), PR #25 (base main): lens A r2 approved, lens B + privacy r1 folded in, CI green.
- **Owner chose A for H2:** #25 is NOT merged until go/no-go. The owner tests the branch build at `worktrees/spc-22/apps/extension/.output/chrome-mv3` (built by the orchestrator at cfe7616), loaded unpacked, with the Groq key in Options and `?labs=1` → Labs → Critique panel.
- Live: pe-1b (w1:pN, worktrees/pe), spc-22-f2 (w1:pP, worktrees/spc-22), both idle and waiting. On go: polish ticket(s) + a shipping decision (build gate vs release). On no-go: close #25, remove the worktree.

## UPDATE 2026-10-15 (folders moved; fresh PE)

- The owner ran the folder move: main checkout `specimen-herdr/specimen`, worktrees `specimen-herdr/worktrees/` (sprint-log, pe). The old `Specimen`/`Specimen-wt` are gone; the memory dir was copied to the new project key. **The orchestrator session is now `specimen-53`.**
- A fresh PE was started on 2.1.300 (pane w1:pN, worktree worktrees/pe, branch pe/sprint-2), reviewing PR #24 (sprint/log → main, doc-only). Then SPC-22.
- Scratchpad (kickoffs): /private/tmp/claude-501/-Users-ayushmayank-Claude-coding-Projects-specimen-herdr-specimen/015cf71f-2911-4db4-8f1b-44b3361da55e/scratchpad

## UPDATE 2026-10-15 (Sprint 1 complete; wrap-up)

- All sprint tickets are Done; summary in `docs/sprint/standups/2026-10-15-sprint-1-summary.md`. The PE (pe-5e) and all executors are closed; pe.md has been copied here.
- Folder move: the owner runs `~/move-specimen.sh` after `/exit` (moves to `specimen-herdr/specimen` + `specimen-herdr/worktrees`, runs `git worktree repair`, copies the Claude memory dir to the new project key), then `claude --continue` in `specimen-herdr/specimen`.
- Wrap-up in progress: (1) PR #24 sprint/log → main (docs only; CLAUDE.md pointer updated); (2) move the folders into `specimen-herdr/`; (3) SPC-22 spike with a fresh PE + executor on Claude Code 2.1.300.

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
