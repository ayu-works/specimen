# SPC-11 lens A + measurement review, round 1 (PE, 2026-10-14)

PR #22 (base `exec/spc-8`). This round reviews only commit 2399677, the SPC-11 work. The #18 files in the diff came in
with the merge from `main` and are already reviewed.

**Result: 0 CRITICAL · 0 HIGH · 1 MEDIUM · 2 LOW.** Lens A approves once M1 is done (it only needs the PR body).

## Live-site check: does the new CSP break anything the pages use?
No. I scanned both pages for every resource type a CSP governs. The only things they load are:
- the inline `<script>` on `/` (allowed by `script-src 'unsafe-inline'`);
- the inline `<style>` blocks (`style-src 'unsafe-inline'`);
- `data:` SVG images (`img-src data:`);
- the two `/fonts/*.woff2` files (`font-src 'self'`; the preloads are font requests too).

Nothing else is loaded or sent: no external stylesheet, script, image, iframe, media, fetch or XHR, beacon, worker or
form. `preconnect` / `dns-prefetch` to the Chrome Web Store and GitHub aren't blocked by CSP. Removing
`fonts.googleapis.com` / `fonts.gstatic.com` is safe, because no page references them any more.

`connect-src 'self'` follows the owner's option A, and it's justified by the measured 0.91 → 1.0 SEO difference (the
robots.txt fetch). The site tests serve the same netlify.toml headers and fail on any CSP violation, so a break would
have shown up in `pnpm e2e`.

## Checked and fine
- **Fonts and licence.** Press Start 2P is the complete, unmodified upstream TTF converted to WOFF2. The README records
  the source, version and sha, and why it isn't a subset (the Reserved Font Name). VT323 is the Google latin subset; it
  has no RFN, so that's allowed. The OFL texts ship in `site/fonts/`. There's one copy, used by the site and the tests.
- **Pass bar.** It was fixed in the handoff before the first run: raw median ≥ 0.95, with no rounding.
  - `verdict` fails on `!(median >= bar)`, which also catches NaN.
  - A `runtimeError` run, a null score, or fewer than 3 scores fails the page.
  - The display keeps one decimal, so 0.949 never shows as "95".
- **Crash handling.** A crash (Chromium missing, lhci error) exits 2 and gets its own "did not run" warning and
  summary line. If the crash happens part-way, the runs that finished are still reported. Cleanup is in `finally`, and
  a cleanup error is logged without masking the exit code.
- **Font-failure warning.** It's driven by the `network-requests` audit: no Font request at all, a status other than
  200, or -1 (failed) is flagged.
- **Fonts-blocked e2e test.** It now asserts exactly the two font 404s and their two console errors, plus both faces
  missing.
- **New dependency.** `@lhci/cli` brings `lighthouse` and `puppeteer-core` (not `puppeteer`), so nothing downloads a
  browser on install, and `onlyBuiltDependencies` still gates install scripts.
- **CI workflow.** `lighthouse.yml` is read-only (`contents: read`, no persisted credentials), path-filtered and
  non-blocking (`set +e`, exit code recorded). Reports are uploaded `if: always()`.

## MEDIUM

**M1. The "after" scores come from a local run, but the CI job is the official report.** The handoff records `/` and
`/privacy/` at 100/100/100/100 from the executor's machine. CI runners are slower and noisier, and Performance is the
category most likely to drop below 0.95 there.
- *Failure scenario:* the PR is merged on "Pass", and the first CI report on `main` shows Performance at 0.93. Nobody
  checked the runner number before the site went live, and the sprint's T7.02 claim rests on a local measurement.
- *Fix:* before merge, paste the CI `T7.02 Lighthouse` job summary table from this PR's run (the job runs, because
  the PR touches `site/**`) into the PR body, next to the local numbers. If CI is under the bar, record it as the
  honest result. It's non-blocking, so this is a reporting fix, not a re-design.

## LOW

**L1. The fonts warning is only an annotation in CI.** `::warning::` is printed only when `GITHUB_ACTIONS` is set.
Locally the warning appears only in the printed markdown, which is fine. Consider also returning a distinct exit code,
or failing `verdict`, when fonts failed and the scores still pass, so a "Pass" on fallback fonts can't happen silently.
At minimum, the markdown's "**Pass.**" line could say "Pass (fallback fonts)" in that case.

**L2. The fonts-blocked test asserts Chromium's exact console text** ("Failed to load resource: the server responded
with a status of 404 (Not Found)"). A Playwright or Chromium upgrade could reword it, making the test fail for no real
reason. *Fix (optional):* match the console errors with a regex on `404`, and keep the exact HTTP-404 URL assertions,
which carry the real signal.
