# Sprint 3 plan: the backlog (bug fixes + panel state)

Approved by the owner on 2026-10-15 ("start working on all the other tickets"). **No CWS release** in this sprint
(the owner's call): fixes merge to `main` and ship with the next release, whenever the owner decides. Sprint 2 (Council
v2, SPC-22/24) is merged and summarised in git history.

**Done when:** every ticket below is merged with green CI, or explicitly parked by the owner.

## Lanes (2 executors; no two lanes edit the same files at once)
| Lane | Tickets, in order | Main files (Owns while active) |
|---|---|---|
| **A** (core / ai / offscreen) | SPC-16 → SPC-17 → SPC-18 → SPC-21 | `packages/ai/src/errors.ts` + providers (16); `packages/core` sanitize + schema/migrate (17); `offscreen/llmHost.ts` (18); `test/helpers/chrome.ts`, wxt e2e config (21) |
| **B** (side panel / scan flow) | SPC-25 → SPC-26 → SPC-19 → SPC-20 → SPC-27 | `lib/captureFlow.ts`, `Scan.tsx` (25); `sidepanel/store.ts`, `App.tsx`, `lib/db.ts` (26); `lib/libraryIO.ts`, `scanFlow.ts` (19); `runScan.ts`, `scanFlow.ts`, `background.ts` capture, `core/cssText.ts` (20); `views/Inspect` (27) |

Cross-lane rules:
- SPC-21 changes the shared chrome stub that every test uses: it runs last in lane A and must stay backward compatible (deny is opt-in).
- `docs/TESTING.md`: each ticket adds its own rows; the second PR to merge rebases. No ID reuse.
- **Contracts needing the owner's OK:** SPC-17's `DesignScan` `schemaVersion` bump plus the migration.
- SPC-18 vs Council: `llmHost` now serves the council too (SPC-24); keep `attachLlmPort` behaviour, and the PE checks the council tests.

## Not in this sprint
- **SPC-23** (/fonts Cache-Control): a `site/` change, so it costs a Netlify deploy (15 of 300). Hold until other site work, or the owner says go.
- **SPC-9, SPC-10:** the owner's own items (manual checks, MCP decision).

## Reviews
Code PRs: PE lens A + a fresh lens B (security for 16, 17, 18; privacy for 26: what is stored). Contract changes go to the owner.
