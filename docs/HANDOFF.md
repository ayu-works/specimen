# Session handoff (2026-10-09)

Read `CLAUDE.md` first. It holds the workflow and rules. This file says where things stand.

## Done and merged to `main`
| Phase | What | PR |
|---|---|---|
| 0 | Monorepo scaffold, WXT extension, CI | #1 |
| 1 | Sampler + extractors + Scan/Inspect UI, overlays, eyedropper | #2 |
| 2 | Prompt (5 targets) + DESIGN.md + token generators; Generate view is **Prompt / DESIGN.md + target logos** only | #3 |
| 3 | AI layer: local Gemma (WebLLM, bundled .wasm), any API key, Ask, Polish, Vibe, "Fetch models" | #4 |
| 4 | Library (Dexie), Compose (inside Library), Themes; schema v2 | #5 |
| 5 | Fidelity check, components + states, mobile/dark capture, a11y, multi-page; schema v3 | #6 |

## Open / paused
- **PR #8 `ux-fidelity-card`** (open): Fidelity card is "Already built a page from this?", collapsed, shows Original → Your build. It's included in `testing-pass`.
- **Phase 6 MCP**: built, then **cancelled by the user** to rethink. PR #7 is closed; the branch `phase-6-mcp` is kept. Open questions (from the chat): is the value only the self-check loop (`check_build`)? How much browser control should agents get? Should it be a standalone headless CLI instead? Should it come before or after launch?
- **Phase 7** (website + Remotion video) is not started. The video length is still unconfirmed: the user said "3 sec"; it could be a 3 s loop and/or 30 s.
- **Launch** (Chrome Web Store, npm, v1.0) only **after** the testing pass.

## Testing pass (in progress) on branch `testing-pass` (pushed)
Based on `ux-fidelity-card`. Three Sonnet agents ran in worktrees under `.claude/worktrees/`:
- **B (packages/ai)**: ✅ merged. 75 tests plus 7 extension AI tests (`apps/extension/test/ai`). Fixed: `compactScan` sent token ids instead of hexes (Ask answered the wrong colours); model ranking and filtering (Groq picked `allam`/`orpheus`); Groq preset default is now `openai/gpt-oss-20b`. Mock provider: `@specimen/ai/testing`.
- **A (packages/core)**: ✅ merged. 57 tests. Fixed: dense-app navy ink (`isInk`), stats wins over hero, -0 normalisation, merge used the wrong cluster threshold. `scripts/check-test-ids.ts --all` (phases 0–5). T1.27 snapshots committed.
- **C (apps/extension + e2e + CI)**: ✅ merged. 31 vitest + 26 e2e tests green in its worktree. Fixed mobile capture: it never stores a > 480px "mobile" variant; with the `debugger` permission granted it emulates 390px; otherwise the card says "Mobile: not captured" and offers "Capture with permission". Added `fixtures/pages/{components,dark-mode}.html`, a `test.scanCopy` hook (E2E build only), and `gate` → `check-ids --all`.
- `pnpm check-ids --all`: **all 87 phase 0–5 IDs present.**

### ⚠️ Decision needed (user)
**The Alt+Shift+C copy fails in the real extension.** The offscreen `execCommand('copy')` needs the `clipboardWrite` permission, which isn't in the manifest (ARCHITECTURE §10 and T0.03 pin the list). The E2E build pre-grants it, so tests pass there. Options: add `clipboardWrite` (a low-risk permission that shows no install warning), or drop the copy and have the shortcut open the panel on Generate. Recommendation: add `clipboardWrite`, then update §10 and T0.03.

### Next steps
1. Resolve the `clipboardWrite` decision above.
2. Run the **full `pnpm gate`** on the merged `testing-pass` (it hasn't run on the combined branch yet; each agent was green on its own) on `testing-pass` and fix failures in batches. Report the real output.
3. **Live AI re-check** with the user's key: `.env` at the repo root (git-ignored, mode 600; `GROQ_API_KEY` is set). Never print the key. Last live result: Ask returned `#533afd` for Stripe ✅, and `gpt-oss-20b` was picked ✅.
4. Open a PR for `testing-pass` and get **CI green** (it has been red since Phase 1 because of deferred tests).
5. Manual items for the user: the Alt+Shift+C shortcut, the Gemma download, and a real "AI builds page → Fidelity check".
6. Then: rethink MCP, then Phase 7, then launch.
7. Clean up worktrees when done: `git worktree remove` for each one, after merging.

## How the user likes to work
- Opus plans and reviews; Sonnet builds. Opus makes small fixes itself.
- **Reduce cognitive load**: no new tabs, fewer choices, plain-language copy.
- Plain-language status updates; merge only when the user says so.
- Manual testing: `pnpm dev` + `pnpm -F @specimen/extension try <url>` opens Chromium with the extension.
