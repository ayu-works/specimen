# SPC-8 handoff: T7.01 + T7.03 website e2e

## Plan (APPROVED by pe-5e, 2026-10-14, with changes folded in below)

PE changes: (1) server sends netlify.toml headers (live CSP); CSP violations fail; negative test (e) external img.
(2) same-origin href equal to a toml redirect `from` counts as resolving and as the CTA. (3) negative tests assert the
specific message. (4) overflow check also flags left < -1. (5) fonts gap noted in PR.


**Pass bar (written before running anything)**
- T7.01, for `/` and `/privacy/` (and `/privacy` without the slash, which Netlify serves via pretty URLs):
  1. Each page loads with HTTP 200, no `pageerror`, no console error, and no same-origin request with status >= 400.
  2. Every same-origin `a[href]`, `link[href]`, `script[src]`, `img[src]` (and `source[srcset]` if any) returns 200 when
     fetched from the local server. Every `#fragment` link (`#how`, `#start`, ...) matches an element `id` on the
     target page.
  3. CTAs: at least one `a[href]` on `/` equals the Chrome Web Store URL and at least one equals the GitHub repo URL.
     Both URLs are read from `netlify.toml`'s `/install` and `/github` redirects (the canonical copy), so a drift between
     the toml and the HTML fails the test. `/privacy/` gets the same CTA check (it links both today).
  4. "Website builds": there is no build (netlify.toml `command = ""`). The equivalent is item 1: the folder serves with
     no errors. Noted in the PR.
- T7.03, at viewport 375x812 on `/` and `/privacy/`, after scrolling to the bottom (in case of lazy layout):
  1. `documentElement.scrollWidth <= innerWidth` and `body.scrollWidth <= innerWidth`.
  2. `scrollTo(500, 0)` leaves `scrollX === 0`.
  3. No rendered element's right edge exceeds `innerWidth + 1`, unless an ancestor other than `html`/`body` clips it
     (overflow != visible). Reason: the site sets `body{overflow-x:hidden}` at phone width, which would hide a
     500px-wide element from checks 1 and 2 while still cutting content off. If this check turns out to flag
     intentional design (e.g. the `.bar nav` horizontal scroller, which is clipped by its own overflow so it's
     excluded), I'll report it to the PE rather than loosen it silently.
- Negative proof (the failure path): the same checker functions run against a temp copy of `site/` with (a) one
  internal link pointed at a missing file, (b) a missing anchor id, (c) a CTA href changed, (d) a 500px-wide `div`
  injected. Each must make the checker report a failure. These ship as tests (`T7.01 detects ...`, `T7.03 detects ...`).

**Approach**
- Location: `apps/extension/e2e/site/` (lane B's new folder). The existing Playwright config (`testDir: './e2e'`) picks
  it up, so it runs in `pnpm e2e` and therefore in `pnpm gate` and CI, with **no change to root `package.json`, CI
  workflows or playwright.config.ts** (lane A owns those). Fast local run:
  `pnpm -F @specimen/extension exec playwright test e2e/site`.
- Tests use plain `@playwright/test` (`chromium`), not the extension fixture.
- `e2e/site/server.ts`: tiny `node:http` static server on `127.0.0.1:0` (random port) for a given root dir. Maps
  `/dir/` and `/dir` to `dir/index.html` (Netlify pretty URLs), returns 404 otherwise, rejects paths that escape the
  root. Started in `beforeAll`, closed in `afterAll`.
- `e2e/site/checks.ts`: `collectLinkProblems(page, origin)`, `ctaProblems(page, urls)`, `overflowProblems(page)`,
  `readCanonicalUrls(netlifyTomlText)` (regex over `[[redirects]]` from/to; throws if `/install` or `/github` missing).
  Each returns a list of human-readable problems; tests assert `toEqual([])` so the failure message names the link.
- `e2e/site/site.spec.ts`: T7.01 and T7.03 tests on the real `site/`, plus the negative tests on a temp copy
  (`mkdtemp` in os tmpdir, removed in `afterAll` with `force: true`).
- **No external requests:** `context.route` fulfills every non-127.0.0.1 request with an empty 200
  (Google Fonts CSS/fonts), so nothing leaves the machine and no "failed to load" console noise. External links are
  only asserted on as href strings.

**Files:** `apps/extension/e2e/site/{server.ts,checks.ts,site.spec.ts}`, this handoff file. Nothing else.
(T7.01/T7.03 IDs won't be enforced by `check-ids --all` until SPC-14 adds phase 7; the names follow the prefix rule now.)

**Failure modes**
- Port clash / concurrency: random port per run; workers=1 already. Server close in `afterAll` even when tests fail.
- Cleanup errors: temp dir removal uses `force: true`; a failed removal can't fail the suite.
- Drift between two copies of a fact: CTA URLs come from netlify.toml, not hard-coded in the test.
- Masked overflow: check 3 above (body `overflow-x:hidden`).
- False green from external fonts not loading: layout at 375px is measured with fallback fonts. Accepted: wider
  real fonts could overflow where fallbacks don't. Mitigation: none without network; noted in the PR. (VT323 /
  Press Start 2P are the fonts; Press Start 2P is wide, so this is a real gap. Optional: if the owner wants, vendor
  the fonts later; out of scope.)
- Flake: wait for `load` + scroll to bottom + `document.fonts.ready`; no timeouts-based sleeps.

**Tests:** the spec itself; plus the four negative tests above. Gate: `pnpm gate` green (the ticket's check).

Later decisions (2026-10-14): PE approved vendoring the fonts (fonts-loaded assertion required, README with source
and OFL, a fallback-font T7.03 variant). The orchestrator filed the site bug as SPC-15 and folded its fix into this PR:
`code{overflow-wrap:anywhere}` in `site/privacy/index.html` (the only site/ edit), so the fallback variant ships
passing with no fixme.

## Done
- `apps/extension/e2e/site/`: `netlify.ts` (redirects + headers from netlify.toml), `server.ts` (pretty URLs,
  redirects, live CSP headers), `checks.ts` (load/CSP, links/anchors, CTAs, fonts, overflow), `site.spec.ts`
  (15 tests: 10 on the real site, 5 negative on a temp copy), `fonts/` (vendored latin woff2 + OFL + README).
- Overflow is measured against the device width (375), not innerWidth: with `isMobile` Chrome widens the layout
  viewport to fit too-wide content, so innerWidth grew with the bug and hid it.
- Found and fixed SPC-15: `/privacy/` overflowed to 444px with fallback fonts (`<code>` tokens).
- `pnpm gate` green on 2026-10-14: exit 0; e2e 41/41 including the 15 site tests; check-ids 87 IDs for phases 0-5.
  T7.01/T7.03 aren't enforced by check-ids until SPC-14.

## Next
- PR open → PE lens A + lens B review → fold in findings.

## How to resume
- Worktree `Specimen-wt/spc-8`, branch `exec/spc-8`. Read this file; PE is `pe-5e`, orchestrator `specimen-b0`.
- Fast run: `pnpm -F @specimen/extension exec playwright test e2e/site`.
