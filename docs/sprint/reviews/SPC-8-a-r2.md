# SPC-8 lens A review, round 2 (PE, 2026-10-14)

Commit 386b41c, reviewed as the diff from ae1a6b7.

**Result: 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW. Lens A approves; stop rule met.**

- **H1 fixed.** Only `overflow-x: auto|scroll` ancestors excuse an element. `.scene{overflow:hidden}` therefore no
  longer hides anything. An ancestor with `overflow-y:auto` computes `overflow-x` to `auto`, which correctly counts as
  a scroller. The text-node Range pass catches tokens running past a box that itself fits. `.sr` is the only
  exemption, it's explicit, and it has a reason. The new negative test on `/` (a 500px div plus a long token inside
  `.scene .inner`) asserts both exact messages.
- **The new check found a real bug.** `.source pre` on `/` reached 442px with fallback fonts. The one-line
  `overflow-wrap:anywhere` in `site/index.html` is the right fix; it's user-facing on merge, and the orchestrator
  authorized it.
- **L1–L3 fixed** as asked, each with a negative test: DOMParser plus the `data-id` decoy; `family=VT32` gives
  "font not loaded: VT323"; `/privacy` 301s to `/privacy/`.
- I saw nothing new in the lens-B fixes (short-link trailing slash, fixture-owned contexts, `src:local(nonexistent)`,
  `fonts.load`, extra selectors) that affects correctness.
