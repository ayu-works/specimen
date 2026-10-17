# Merge report (Sprint 3, Oct 2026)

Short and plain: one or two lines per item.

## Ready to merge
_None yet._

## Decisions taken for you (standing OK: "go with the recommended")
- **SPC-44 — remove the `debugger` permission (option B, you OK'd it directly).** Dark-mode and exact-mobile capture never worked for real users (Chrome refuses the permission at click time). We remove them and keep the permission-free fallbacks. Trade-off: some sites get estimated dark colours, and mobile scans may be a little wider than 390px.

## Checks only you can do (SPC-9)
_Steps will go here._

## Merge order
_Filled in at the end._
