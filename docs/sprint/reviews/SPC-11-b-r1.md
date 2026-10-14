# SPC-11 review: lens B + security + measurement, round 1

Reviewer: fresh second reviewer, 2026-10-14. Scope: the SPC-11 commit only (`git log origin/exec/spc-8..HEAD --no-merges`
→ 2399677); the #18 files in the PR diff come from the main merge, which was already reviewed, and were skipped.

**Verdict: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 4 LOW. Nothing found that breaks the live site.** Fold the MEDIUM before merge; the LOWs are optional.

## What I verified (evidence, not assumptions)
- **CI matches local.** The PR #22 run 38574215249 (`T7.02 Lighthouse (report only)`, ubuntu-24.04) ran 3× per page:
  `/` 100/100/100/100, `/privacy/` 100/100/100/100, **Pass**, the same as the handoff's local numbers. `gate` passed too.
- **The job can't block a merge.** `main` has no branch protection (`gh api .../branches/main/protection` → 404 "Branch
  not protected"), so no check is required. The `lh` step uses `set +e` and records `$?`, and the step itself always
  exits 0. Token: `Contents: read, Metadata: read` (from the run log); `persist-credentials: false`; no `secrets.*`.
  The artifact holds only LHRs of a localhost server.
- **Exit codes survive pnpm.** `PLAYWRIGHT_BROWSERS_PATH=/nonexistent pnpm -F @specimen/extension lighthouse` → exit
  2 (pnpm 10.34.6 passes the child's code through `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`), so the workflow's 1 vs "did
  not run" split is real.
- **Font paths under `base = "site"`.** `/fonts/*.woff2` are root-absolute and `site/fonts/` publishes at `/fonts/`;
  the e2e server serves `site/` as root with `.woff2 → font/woff2`, and the 17 site tests load them. Netlify serves
  `.woff2` as `font/woff2`, so `X-Content-Type-Options: nosniff` is fine. Same-origin preload with `crossorigin`
  matches the CORS-mode font fetch (no double download; BP is 100).
- **Nothing else the pages use is affected by the CSP change.** The only external URLs in either page are `<a href>`s,
  one `preconnect` (chromewebstore) and one `dns-prefetch` (github): no CSP directive governs these. There is no
  `fetch`/XHR, no external `<img>`, and the one inline `<script>` (index.html:478) still has `script-src
  'unsafe-inline'`. The redirects (`/install`, `/github`) are untouched.
- **Press Start 2P is the complete upstream font.** I downloaded `ofl/pressstart2p/PressStart2P-Regular.ttf` from
  google/fonts: sha256 `034c77f1…728e017d`, which matches site/README.md. Compared with fontTools: same 658-glyph order,
  0 outline differences, identical cmap, identical `name` records (26, "Press Start 2P" / "Version 3.000"). The only
  differences: `DSIG` dropped, and `head.checkSumAdjustment` / `head.modified` recomputed by the save. All other tables
  match byte for byte. That is a lossless format conversion, not a Modified Version, so the RFN is respected.
- **VT323** is byte-identical to the file #19 vendored (`baeb41f0…`), its OFL has no Reserved Font Name, and both
  OFL texts ship next to the fonts (`/fonts/OFL-*.txt` on the live site).
- **Stale references:** `git grep` finds no remaining `fonts.googleapis`, `e2e/site/fonts` or `pressstart2p-latin`
  outside fixtures and sprint docs.
- **Security, net:** **tighter.** Two third-party origins are gone (`https://fonts.googleapis.com` from style-src,
  `https://fonts.gstatic.com` from font-src), and no new external origin is added. One directive is looser:
  `connect-src 'none'` → `'self'` (see LOW-4).

## MEDIUM

### M1. The job "never fails" only for the Lighthouse step; setup failures or a hang turn it red, and nothing bounds a hang
`lighthouse.yml` has no `timeout-minutes` (none of the workflows have one), and only the `lh` step is guarded.
- **Failure scenario:** a Chrome hang inside `lhci collect` (a known occurrence on shared runners; `serveSite` keeps the
  socket open, so lhci waits for its own `maxWaitForLoad` per run and can stall on a stuck target). The job then
  runs until GitHub's 6-hour default and the PR shows a pending, later red `T7.02 Lighthouse` check. Separately, a
  failed `playwright install --with-deps` (apt mirror flake) or `pnpm i` turns the check red with no `::warning::` and
  no summary. Neither blocks a merge (no protection), but the ticket and PR say the job "never fails". A red or
  hours-long pending check on the stacked #19 merge PR is exactly what the owner will be asked to ignore, and a
  6-hour run also holds the concurrency group, so a newer push to the same ref cancels it only on the next trigger.
- **Fix:** add `timeout-minutes: 15` to the job (a normal run is ~1m45s), and either `continue-on-error: true` on the
  job or on the install steps. Or reword the PR/handoff to "the Lighthouse step never fails the job; setup can". If
  you keep the timeout red, a short line in the workflow header saying a red/cancelled job means "did not run" is
  enough.

## LOW

### L1. The `paths` filter misses the Lighthouse tool's own dependency
`apps/extension/package.json` and `pnpm-lock.yaml` aren't in `paths`. **Scenario:** a Renovate/dependabot or manual
bump of `@lhci/cli` (or Playwright's Chromium) changes the scores and is never measured until someone touches
`site/`. **Fix:** add `pnpm-lock.yaml` (or accept it and rely on `workflow_dispatch`; say so in the header).

### L2. Local and CI measure a server with no compression and no cache headers; Netlify differs
`serveSite` sends only the netlify.toml headers: no `Content-Encoding`, no `Cache-Control`. Netlify adds brotli/gzip
and `cache-control: public, max-age=0, must-revalidate`. **Scenario:** none today (100 everywhere, and uncompressed
is pessimistic for Performance). But a 100 doesn't prove the live caching is good: every navigation on the live site
revalidates both fonts (a 304 round trip each, ~60 KB uncompressed total on first load). **Fix (optional, a
`netlify.toml` change, goes live):** `[[headers]] for = "/fonts/*"` with `Cache-Control = "public, max-age=604800"`
(not `immutable`, since the file names aren't hashed). Otherwise add a line to the handoff that the bar measures the
pages and headers, not the CDN.

### L3. "unmodified" in site/README.md slightly overstates; make it precise
The README says "complete, unmodified" and "same glyphs and cmap; the woff2 format drops the DSIG table". It's true in
substance (verified above), but the save also rewrote `head.modified` and the checksum. **Scenario:** a later
maintainer re-converts with different settings (say `--subset` or name edits), reads "unmodified" as "any fontTools
output is fine", and ships a Modified Version under the reserved name. **Fix:** "converted losslessly with fontTools
(`fontTools.ttLib.woff2.compress`): glyphs, cmap and name table unchanged; DSIG dropped and `head` timestamp/checksum
recomputed. Never subset or rename it: the name 'Press Start 2P' is reserved." Optional: record the woff2's own
sha256 too, so drift is detectable.

### L4. `connect-src 'self'` is a live-policy loosening made for a tool artifact; record it as such
`'none'` → `'self'` exists only because Lighthouse fetches `/robots.txt` from the page context (PE measured SEO
0.91 vs 1.0). The pages make no connections themselves. **Risk:** small: same-origin only, static site, no
endpoints or cookies, so an injected inline script still can't exfiltrate via `connect-src`. **Scenario:** a future
edit that adds a same-origin endpoint, such as a Netlify function, inherits a CSP that already allows it, with no
review. **Fix:** no code change (owner decision, option A). Add one comment line above the CSP in netlify.toml:
`# connect-src 'self' only so Lighthouse's robots.txt check can run; the pages make no requests.`

---
Not findings: `concurrency` keyed on `github.ref` (a PR's `refs/pull/N/merge` is per PR; fine); actions pinned by
major tag, which matches ci.yml; `if-no-files-found: ignore` is right for the exit-2 path; `--no-sandbox` is needed on
the Ubuntu runner and is harmless for a localhost-only run.
