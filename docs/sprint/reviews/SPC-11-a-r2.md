# SPC-11 lens A + measurement review, round 2 (PE, 2026-10-14)

Commit 2184d90, reviewed as the diff from 2399677.

**Result: 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW. Lens A approves.**

- **M1 fixed.** The PR body now cites this PR's CI run 38574215249 (ubuntu-24.04, Pass) next to the local numbers, and
  says which numbers are which. That run is on 2399677. The fix commit changes no `site/`, `netlify.toml` or runner
  code, so the measured page is the one that ships. The job's conclusion is always "success" by design, so the
  evidence is the summary table, not the green tick; the body cites the table.
- **L1 fixed.** The verdict line reads "**Pass (fallback fonts).**" when a font request failed, and a test asserts that
  a plain "**Pass.**" is absent in that case.
- **L2 fixed.** The exact HTTP-404 URL assertions are kept. Console errors are counted (one per font) and matched only
  on `404`.
