# Merge report (Sprint 3, Oct 2026)

Short and plain: one or two lines per item.

## Ready to merge
- **#39 SPC-28: scans of a URL no longer hang.** A re-scan or mobile capture could wait forever if the page finished loading too fast. It now always notices, and gives up with a clear message after a time limit.
- **#40 SPC-21: tests can now say "no".** Test-only. The tests can finally check what happens when you refuse a permission or have no WebGPU (for example, the key isn't saved and you get a clear message).

## Decisions taken for you (standing OK: "go with the recommended")
- **SPC-44 — remove the `debugger` permission (option B, you OK'd it directly).** Dark-mode and exact-mobile capture never worked for real users (Chrome refuses the permission at click time). We remove them and keep the permission-free fallbacks. Trade-off: some sites get estimated dark colours, and mobile scans may be a little wider than 390px.

## Checks only you can do (SPC-9)
_Steps will go here._

## Merge order
_Filled in at the end._
