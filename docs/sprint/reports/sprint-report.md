# Sprint report (run of 2026-10-17, afternoon)

Short and plain. The merge checklist is in `../merge-report.md`.

## How the team ran
- 3 builders at a time, by priority. Every PR got 2 reviews (the PE, plus a fresh second reviewer) and green checks.
- Nothing is merged yet. You merge everything at the end with "merge all".
- For this run only: I take the recommended option on decisions, and list each one below.
- New: a **keeper** agent (its own tab) restarts me at 30% context. I restart the PE (also at 30%) and the builders myself. I did this once already: pe-4d became pe-b2.

## Fixes
| Ticket | PR | What it fixes for users | Status |
|---|---|---|---|
| SPC-28 | #39 | A URL re-scan or mobile capture no longer hangs when the page loads fast. It also stops with a clear message after a time limit | Ready |
| SPC-21 | #40 | Tests only: the tests can now check a refused permission or a missing WebGPU | Ready |
| SPC-29 | #41 | Tests only: a council test that failed randomly on CI is fixed | Ready |
| SPC-37 | #42 | Local Gemma: deleting or unloading during a download no longer gives a wrong state. The Delete-then-Download button glitch is fixed too | In review |
| SPC-44 | #43 | Removes the `debugger` permission. Dark and exact-mobile capture never worked for real users; the fallbacks stay | In review |
| SPC-40 | #44 | A stuck "vibe" AI call no longer leaves a Library card busy forever | In review |
| SPC-38 | — | A failed scan no longer shows the previous scan's card underneath | Building |

## Decisions taken
- **SPC-44:** remove `debugger` (you chose B). Trade-off: some sites get estimated dark colours, and mobile scans may be a bit wider than 390px.
- **SPC-21 scope cut (PE):** the debugger tests moved to SPC-44, so SPC-21 is tests only.
- **Privacy page (PE):** the `debugger` mention is removed together with SPC-23, keeping it to one website deploy.
- **SPC-37 (orchestrator):** the extra Gemma card glitch was fixed in the same PR, not a new ticket.
- **File splits:** where two PRs would touch the same file, one builds on top of the other (#43 on #39, SPC-38 on #43) or puts its tests in a new file.

## Found along the way
- **SPC-44 (High):** the debugger bug above, found while writing SPC-21's tests.
- **SPC-45 (Low):** a re-scan that times out leaves its tab open. It also decides what to do with a page still loading at the time limit.

## Your to-dos
- At the next Chrome Web Store upload: remove the `debugger` justification in the dashboard.
- Your test copy (`~/Desktop/specimen-critique-test`) was rebuilt from main. Reload it in `chrome://extensions` to see the Library delete fix.
- Linear: 2 small steps in `linear-report.md` (rename the team, create Growth).

## Still to do
SPC-41, 42, 43, 45, 30, 31, 36, 27, 23, 10, then the final "merge all". SPC-9 (manual checks) stays with you.
