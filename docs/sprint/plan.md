# Sprint 2 plan: critique-panel spike (SPC-22)

Approved by the owner on 2026-10-14/15 ("right after this sprint"; tests it with their own **Groq** key). Sprint 1's plan
and results are in git history and `standups/2026-10-15-sprint-1-summary.md`.

**Done when:** the owner can open a dev build of the extension, scan a site, start a "critique panel" where 2–3 AI
reviewers with different viewpoints discuss the scan in turns, type into the discussion to steer it, and get a short
"keep / change" list at the end, using Groq through the existing BYOK preset. The owner then decides go / no-go (a
comment on SPC-22).

**Hard limits (from CLAUDE.md and the owner):**
- **No CWS release.** The feature sits behind an off-by-default flag. The owner tests it in a dev build loaded unpacked
  (`pnpm build`, then load `apps/extension/.output/chrome-mv3`). The published extension is unchanged.
- **Grounded in the scan:** every reviewer sees the same `compactScan` in `<page_data>`, the same as `ask()`. No brand names in
  output (the guardrail sanitizer applies to every turn).
- **Cost cap:** a visible turn/round limit (default: 3 reviewers × 2 rounds + 1 summary), with a Stop button. Abort
  stops all streaming.
- **Provider-agnostic:** it uses `LLMProvider` only. Works with any configured provider; with no provider it shows the
  same setup hint as Ask (degrades gracefully).
- **Keys:** agents never handle the real key; tests use the mock provider. The owner enters the Groq key in Options.
- **No `site/` change** (no Netlify deploy). No `DesignScan` schema change.

## Lanes
| Lane | Owns | Ticket |
|---|---|---|
| **C** | `packages/ai/src/features/critique*.ts` (+ tests), `apps/extension/src/entrypoints/sidepanel/views/Critique*.tsx` (+ tests), the minimal wiring in the side-panel nav/App, and the flag (Options or storage), as agreed in the plan | SPC-22 |
| **PE** | reviews; `docs/sprint/reviews/` | |

## Tickets
| Ticket | What | Reviews |
|---|---|---|
| SPC-22 | Critique-panel spike behind a flag. **Done 2026-10-15: the owner said GO with a redesign** | PE lens A + lens B + privacy |
| SPC-24 | Council v2: merge Ask + Council; human context box; runs in the background (panel closed); mascot status, click to reopen; verdict-only report (no prompt); "show discussion" collapsed. Branch from exec/spc-22; PR #25 superseded | PE lens A (+ the background architecture call) + lens B + privacy |

## Backlog (owner picks next)
SPC-16 to SPC-21 (audit bugs, need v1.0.1), SPC-23 (/fonts Cache-Control, batch with site work), SPC-9 (manual checks),
SPC-10 (MCP), token exports in the side panel, extraction-accuracy measurement.
