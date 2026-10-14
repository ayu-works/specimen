# Linear mapping

Workspace **ayu-works** (https://linear.app/ayu-works), region EU. Rules: `docs/sprint/setup.md` §Linear rules.

| Object | Value |
|---|---|
| Team | **Specimen**, key **SPC** (id `504055dc-fd35-45c0-83ed-a181e7163a26`). Every issue lives here |
| Initiative | None yet: the Linear MCP has no tool to create one. Add "Specimen after v1" in the app if wanted |
| Project **Quality & Tests** (`P-SPC-1`) | Tests, the test-ID checker, `pnpm gate`, CI workflows. Milestone **S1: test gaps closed** |
| Project **Extension** (`P-SPC-3`) | Product code: `packages/core`, `packages/ai`, `apps/extension`. Reaches users only through a CWS release. Holds the SPC-13 audit tickets SPC-16 to SPC-21 |
| Project **Release & Site** (`P-SPC-2`) | CWS releases (owner uploads), GitHub releases, `site/`, `store/`, project docs, owner decisions |
| States | Backlog → Todo → In Progress → **In review** → Done, plus Canceled and Duplicate. The owner added "In review" on 2026-10-14; the `in-review` label is retired (don't use it) |
| Git automation | GitHub connected (2026-10-14), Linear's defaults: **a PR merge may auto-move the ticket to Done.** The orchestrator verifies right after every merge, adds the closing comment, and reopens if it didn't really ship |

**Labels:** `sprint` · `lane-a` · `lane-b` · `needs-owner` · `blocked` · `chore` · `measurement` · `contract` · `in-review`, plus
the workspace's `Feature`, `Bug`, `Improvement`.

**What goes where:** a test, CI or gate change → Quality & Tests. A release, website, store or docs change, or an owner
decision → Release & Site. Feature (depth) work gets its own project when the owner picks the first feature.

SPC-1 to SPC-4 are Linear's own onboarding issues; they belong to the owner and aren't sprint work.

Branch names: the team's Linear branch format is `ayushmayank77/spc-<n>-…`, but sprint branches are
`exec/spc-<n>`. Put the ticket id (`SPC-6`) in the PR title so GitHub links it.
