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

### Resolved
- **Alt+Shift+C**: no `clipboardWrite` (user decision). The shortcut now opens the side panel, scans and shows Generate; the user clicks Copy. The offscreen document's reason is `WORKERS` only.
- **Full `pnpm gate` is green** on `testing-pass`: 170 unit, 26 e2e, 87/87 IDs.
- **Live AI (Groq, `gpt-oss-20b`)**: Ask ✅ `#533afd` for Stripe, Vibe ✅, no brand leaks. Polish fell back (the model changed hexes; the guard kept the original). The free tier rate-limits at 8k TPM, and the raw Groq error (with the org id) reaches the UI, so it needs a friendlier message.

### Next steps
1. Get CI green on the `testing-pass` PR; merge when the user says so (it includes PR #8).
2. Manual items for the user: the Alt+Shift+C shortcut, the Gemma download, and a real "AI builds page → Fidelity check".
3. Optional cleanup: the unused `offscreen.busy` route; a friendlier rate-limit error.
4. Then: rethink MCP, then Phase 7, then launch. Remove the `.claude/worktrees/*` worktrees.

## How the user likes to work
- Opus plans and reviews; Sonnet builds. Opus makes small fixes itself.
- **Reduce cognitive load**: no new tabs, fewer choices, plain-language copy.
- Plain-language status updates; merge only when the user says so.
- Manual testing: `pnpm dev` + `pnpm -F @specimen/extension try <url>` opens Chromium with the extension.
