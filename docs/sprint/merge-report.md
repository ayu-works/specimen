# Merge report (Sprint 3, Oct 2026)

Short and plain: one or two lines per item.

## Ready to merge
- **#39 SPC-28: scans of a URL no longer hang.** A re-scan or mobile capture could wait forever if the page finished loading too fast. It now always notices, and gives up with a clear message after a time limit.
- **#40 SPC-21: tests can now say "no".** Test-only. The tests can finally check what happens when you refuse a permission or have no WebGPU (for example, the key isn't saved and you get a clear message).
- **#41 SPC-29: a flaky test is fixed.** Test-only. A council test sometimes failed on CI for no real reason. It now passes 60/60 even under heavy load.
- **#42 SPC-37: local Gemma stays in a correct state.** Deleting or unloading the model during a download, or downloading during a delete, no longer leaves a wrong status. A quick Delete then Download no longer says "Not downloaded" for the whole download.
- **#44 SPC-40: a stuck AI "vibe" no longer freezes a Library card.** If the AI never answers, the card stops after a time limit, shows an error and goes back to normal. A late answer is ignored.
- **#43 SPC-44: the `debugger` permission is gone** (stacked on #39). Dark-mode and exact-mobile capture are removed because they never worked for real users. Mobile capture via the popup window still works.
- **#45 SPC-41: cloud AI flags a reply cut off at the token limit.** OpenAI-compatible, Anthropic and Gemini now say "cut off" instead of showing half an answer as complete. Settings → Test no longer calls a working reasoning model broken.
- **#46 SPC-38: a failed scan no longer shows the old card as if it were this page** (stacked on #43). The old card is labelled "Previous scan, not this page."
- **#47 SPC-43: two open side panels keep each other's Library up to date.** Delete, rename, tag or favourite in one window shows up in the other. Edits you're typing are kept.
- **#48 SPC-45: a failed re-scan closes the tab it opened** (stacked on #43). A page still loading after 30 s is scanned as it is, if it has really loaded something.
- **#49 SPC-31: brand names written with ß, İ, accents or invisible characters are removed too.** Ethics guardrail; the ™/℠ case is covered.
- **#50 SPC-27: Inspect's hover card works reliably and never cuts off the council or local Gemma.** Fixes a real bug where the card never updated.
- **#51 SPC-36: a backslash before `|` can't split a DESIGN.md table cell.** Trade-off: on GitHub, such a code cell shows the backslashes doubled (rare).
- **#52 SPC-30: "out of credit" is its own message** (stacked on #45). No more "rate limited" countdown when the account simply has no credit.
- **#53 SPC-42: a stopped Ask answer is no longer fed back to the AI as complete** (stacked on #45).
- **#54 SPC-46: cloud AI no longer shows a filtered or cut-short reply as complete** (stacked on #45). Vibe gets more room on thinking models.
- **#55 SPC-55: Vibe works on Groq gpt-oss-20b** (stacked on #54; your bug). Cap 10,000 (falls back to 4,096 if a model refuses), and one retry without JSON mode if the reply fails mid-way. At most 3 requests per Vibe.

## Decisions taken for you (standing OK: "go with the recommended")
- **SPC-44 — remove the `debugger` permission (option B, you OK'd it directly).** Dark-mode and exact-mobile capture never worked for real users (Chrome refuses the permission at click time). We remove them and keep the permission-free fallbacks. Trade-off: some sites get estimated dark colours, and mobile scans may be a little wider than 390px.

- **SPC-41: every cloud AI provider now flags a cut-off reply** (PE recommendation). Before, only local Gemma did. Trade-off: a very long answer shows a "cut off" note instead of looking complete.
- **SPC-36: keep the table-cell fix** (PE recommendation). One cell in every Markdown renderer; rare doubled backslashes on GitHub.
- **SPC-45: scan what's there** for a page still loading at 30 s (PE recommendation), instead of failing.
- **SPC-55: Vibe token cap 10,000** (your decision), with an automatic 4,096 fallback so models with a smaller limit still work.
- **SPC-55: no Groq-specific cap** (your decision): 10,000 everywhere. Accepted risk: free-tier Groq keys may get a "rate limited" error on Vibe (follow-up SPC-59 fixes the message).
- **Lanes:** small leftovers were split into follow-up tickets (SPC-47 to SPC-58) instead of growing PRs.
- **Privacy page wording:** the website still lists `debugger` until SPC-23 ships, so all site/ changes go out in one Netlify deploy. Harmless: it lists a permission we no longer ask for.

## For your next Chrome Web Store upload
- Remove the `debugger` justification in the CWS dashboard (SPC-44 drops the permission).

## Checks only you can do (SPC-9)
_Steps will go here._

## Merge order
No PR touches `site/`, so none costs a Netlify deploy. Each PR is rebased on main, merged with `--match-head-commit`, and main's CI is checked after each merge.
1. **#39** (SPC-28) → **#43** (SPC-44, retarget to main) → **#46** and **#48** (retarget to main).
2. **#40, #41, #42, #44, #47, #49, #50, #51** (base main; TESTING.md rows may need a simple rebase).
3. **#45** (SPC-41) → **#52, #53, #54** (retarget to main) → **#55** (after #54).
Then: Linear Done with closing comments, delete branches, remove worktrees.
