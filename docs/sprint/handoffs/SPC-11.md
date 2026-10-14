# SPC-11 handoff: T7.02 Lighthouse report for site/ (non-blocking CI job)

Stacked: branch `exec/spc-11` from `origin/exec/spc-8` + `origin/main`. PR base = `exec/spc-8` (one Netlify deploy via #19).

## Plan (APPROVED by pe-5e, 2026-10-14, with changes folded in below)

PE changes: (1) allow Google Fonts GETs (fonts.googleapis.com, fonts.gstatic.com) in the Lighthouse run only; report
tests stay offline; exception stated in the script header and PR body. (2) named `lighthouse` script in
apps/extension/package.json. (3) pass = raw median `score >= 0.95`, no rounding; test 0.949 → fail. (4) unit tests
named `T7.02 report: ...`; the PR says the measurement itself is the non-blocking CI job. (5) a crash (lhci error,
Chrome missing) gets a distinct `::warning::` "Lighthouse did not run" (exit 2), separate from "scores under 95" (exit 1). (6) PE + orchestrator: flag any fonts.googleapis.com /
fonts.gstatic.com request in an LHR's `network-requests` audit with status ≠ 200 or failed as "fonts did not load:
scores reflect fallback fonts" (summary + `::warning::`); report test with a failed gstatic request.


### Plan delta: owner chose option A (via specimen-b0, 2026-10-14). APPROVED by pe-5e with changes:
PE #1: Press Start 2P's OFL reserves its name, so a subset can't keep it. Self-host the complete upstream font (lossless
woff2), not Google's latin subset; VT323 (no RFN) keeps the latin subset. PE #2 (keep connect-src 'none') was
withdrawn. FINAL (orchestrator + PE): connect-src 'self', the owner's option A as presented; measured SEO 0.91 with 'none' vs
1.0 with 'self'; no artifact label. PE #3: the fallback test asserts exactly the font 404s and their console errors.
- `site/fonts/`: `git mv` the two latin woff2 files and their OFL texts from `apps/extension/e2e/site/fonts/`, so there's
  one copy and no drift. The source, license and refresh notes from its README move into `site/README.md` ("Fonts").
- `site/index.html` and `site/privacy/index.html`: remove the 2 Google preconnects and the Google stylesheet; add 2
  `<link rel="preload" as="font" type="font/woff2" crossorigin>` plus an inline `<style>` with the 2 `@font-face`
  (`font-display:swap`, same families). Nothing else in `<head>` changes.
- `netlify.toml` CSP: `style-src 'self' 'unsafe-inline'` (drop fonts.googleapis.com), `font-src 'self'`,
  `connect-src 'self'`. Nothing else changes.
- SPC-8 tests: in `checks.ts`, `isolate` drops the Google routing (fonts come from the local server). The fonts mode
  becomes `'web' | 'blocked'`; `'blocked'` answers same-origin `/fonts/*.woff2` with a 404 (what a user sees when the
  fonts fail). The fallback test asserts that the only problems are those font 404s plus their console errors, and
  that both faces are missing. The "font no longer requested" negative test renames the VT323 `@font-face` family in
  the temp copy instead of `family=VT32`. All other assertions stay the same.
- Lighthouse: the Google Fonts network exception is removed (nothing leaves the machine now). The font check becomes:
  every `Font` request in `network-requests` returns 200, and at least one exists; otherwise the run warns "fonts did
  not load: scores reflect fallback fonts". The tests are updated to match.
- Pass bar unchanged. I re-run Lighthouse on the real `site/` and record the scores; `pnpm gate` (includes #19's
  site tests).

**Pass bar (written before running anything)**
- Pages: `/` and `/privacy/`, served locally from `site/` by SPC-8's `serveSite` (pretty URLs + netlify.toml headers,
  so the live CSP and security headers count in Best Practices). Never the live site; no Netlify deploy.
- Lighthouse defaults (mobile form factor, simulated throttling), `--headless=new`, 3 runs per page.
- Score per (page, category) = **median of the 3 runs**, categories performance, accessibility, best-practices, seo.
- **Pass = every one of the 8 raw medians `score >= 0.95`** (0–1 scale, no rounding; 0.949 fails). A run with a `runtimeError`, or a category whose score is `null`, counts
  as a failure for that page (never as a pass, never silently dropped). Fewer than 3 usable runs for a page = failure.
- Today's real scores get recorded here and in the PR body. If a category is < 95: minimal `site/` fix, listed in the PR
  as "goes live on merge"; no redesign. If a fix isn't minimal, I stop and report to the orchestrator instead.

**Approach**
- `apps/extension/e2e/site/lighthouse.ts` (CLI script, lane B's folder; not matched by Playwright's `*.spec.ts`):
  1. Start `serveSite(site/, parseNetlifyToml(netlify.toml))` on 127.0.0.1:random port.
  2. Run `lhci collect --url=<origin>/ --url=<origin>/privacy/ --numberOfRuns=3` with `CHROME_PATH` = Playwright's
     Chromium (`chromium.executablePath()`, same browser locally and in CI), chromeFlags `--headless=new --no-sandbox`,
     cwd = a fresh `mkdtemp` dir (so `.lighthouseci/` never lands in the repo; no .gitignore change).
  3. Read `.lighthouseci/lhr-*.json`, compute medians with the pure functions below, print a table
     (`T7.02 Lighthouse (median of 3) ...`, four numbers per page), append the same markdown table to
     `$GITHUB_STEP_SUMMARY` if set, copy the HTML reports of the median run to `--out <dir>` if given (CI artifact).
  4. Exit 1 if the bar fails, 0 otherwise. Server closed and temp dir removed in `finally`.
- `apps/extension/e2e/site/lighthouse-report.ts`: pure `summarize(lhrs) → {page, category, median, runs}[]`,
  `verdict(summary, bar=95)`, `toMarkdown(summary)`. No I/O.
- `@lhci/cli` added as a devDependency of `apps/extension` (where the e2e lives; root `package.json` is lane A's).
  Local command: `pnpm -F @specimen/extension exec tsx e2e/site/lighthouse.ts` (documented in the handoff and the
  PR; if the PE/orchestrator want a named script, `"lighthouse"` in apps/extension/package.json — say which).
- `.github/workflows/lighthouse.yml` (new file per the override; ci.yml untouched): `on: pull_request` with
  `paths: [site/**, netlify.toml, apps/extension/e2e/site/**, .github/workflows/lighthouse.yml]` + `push` to main
  same paths + `workflow_dispatch`. One job `T7.02 Lighthouse`: checkout (persist-credentials false), pnpm, node 22,
  `pnpm i --frozen-lockfile --filter '!@specimen/video'`, Playwright Chromium (same cache pattern as ci.yml),
  run the script with `continue-on-error: true` on the step, upload the reports with `actions/upload-artifact@v4`
  (`if: always()`), and a `::warning::` annotation when the bar fails. `permissions: contents: read`, concurrency
  cancel-in-progress. Never blocks a merge: the step can't fail the job, and the job isn't a required check.

**Tests** (`apps/extension/e2e/site/lighthouse-report.spec.ts`, Playwright runner, no browser; runs in `pnpm e2e`):
- `T7.02 median of 3 runs per page and category` (odd/unsorted inputs).
- `T7.02 flags a category under 95` (one page's SEO median 0.94 → verdict fails, names page + category).
- `T7.02 a run with runtimeError or a null category score is a failure, not a pass`.
- `T7.02 fewer than 3 usable runs fails the page`.
- `T7.02 markdown summary lists all four categories for every page`.
The full Lighthouse run is NOT in `pnpm gate` (slow, score noise; owner decision: non-blocking). Its real output is
recorded below and shows in the CI job summary.

**Failure modes**
- Score noise (shared CI CPU): median of 3; job non-blocking; numbers are reported, never gate a merge.
- Partial failure: lhci crashes mid-run or a page errors → missing/errored LHRs counted as failures, exit 1, summary
  still written with what exists (marked "missing").
- Cleanup errors: `finally` closes server and removes temp dir with `force: true`; a cleanup error is logged, doesn't
  mask the real exit code.
- Port clash / concurrency: random port; temp dir per run; CI concurrency group per ref.
- Drift between two copies of a fact: one server implementation (SPC-8's `serveSite`) and one header source
  (netlify.toml), so Lighthouse sees the same CSP the tests and Netlify use.
- **External fonts (decision for the PE):** the pages load Google Fonts CSS/woff2 from fonts.googleapis.com /
  gstatic. Lighthouse can't route them to the vendored copies like the Playwright tests do. Proposal: allow these
  two public GETs in the measurement (they're part of real-page performance; no page data leaves; it's a report, not a
  test). Alternative: `--blocked-url-patterns` for them, but blocked requests log console errors (hurts Best
  Practices) and makes Performance look better than reality. I recommend allowing.
- Chrome missing locally: script fails fast with "run `pnpm -F @specimen/extension exec playwright install chromium`".

**Files:** `apps/extension/e2e/site/{lighthouse.ts,lighthouse-report.ts,lighthouse-report.spec.ts}`,
`apps/extension/package.json` (devDependency), `pnpm-lock.yaml`, `.github/workflows/lighthouse.yml`, this file;
`site/` only if a score is < 95.

## Done
- Report logic + runner + workflow as planned; the PE's changes 1–6 are in; option A is in (see the delta above).
- `site/fonts/`: `pressstart2p-regular.woff2` (complete upstream TTF v3.000 → woff2 via fontTools; same glyphs and cmap,
  DSIG dropped by the format), `vt323-latin.woff2` (git mv), both OFL texts (git mv). The source is in `site/README.md`.
- Both pages: Google preconnects and stylesheet replaced by 2 preloads + an inline `@font-face`. netlify.toml CSP:
  `style-src` drops fonts.googleapis.com, `font-src 'self'`, `connect-src 'self'`.
- SPC-8 tests: `isolate` has no Google routing; fonts mode `'web' | 'blocked'` (404 on /fonts/*.woff2); the fallback
  test asserts exactly the 2 font 404s + 2 console 404 errors; the "font no longer requested" fixture renames the
  VT323 face.
- **Scores before (unchanged site, 2026-10-14):** `/` 86/100/100/91, `/privacy/` 88/100/100/91 (perf/a11y/BP/SEO).
- **Scores after (2026-10-14, local macOS, Playwright Chromium 1248, Lighthouse 12.6.1, median of 3):**
  `/` 100/100/100/100, `/privacy/` 100/100/100/100. **Pass.** Every run shows both fonts 200.
- Exit 2 verified (PLAYWRIGHT_BROWSERS_PATH=/nonexistent → "did not run", exit 2).
- `pnpm gate` 2026-10-14: exit 0; e2e 51/51 (17 site + 8 T7.02 report); check-ids 87 (phases 0–5).

- PR #22 opened (base `exec/spc-8`); commented on Linear; specimen-b0 told.
- CI run 38574215249 (`T7.02 Lighthouse (report only)`, ubuntu-24.04): `/` and `/privacy/` 100/100/100/100, Pass.
- Lens A r1 (`docs/sprint/reviews/SPC-11-a-r1.md`): 0C/0H/1M/2L. M1: CI table added to the PR body. L1: "Pass (fallback
  fonts)" when fonts failed (+ test). L2: the fonts-blocked test matches console 404s by regex; URL 404s stay exact.
  `pnpm gate` exit 0 after the fixes (e2e 51/51).

## Next
- Wait for lens B (and any lens A r2); fold findings in new commits.

## How to resume
- Read this file and `git log`, then continue from "Next". Local run: `pnpm -F @specimen/extension lighthouse [--out dir]`.
