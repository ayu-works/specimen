# SPC-8 review, lens B (real-world failures), round 1

Reviewer: fresh lens-B session, 2026-10-14. PR #19 at `ae1a6b7`. Read-only apart from this file.
Method: read the diff, then probed the checkers with a scratch Playwright spec that imports
`apps/extension/e2e/site/{checks,netlify,server}.ts` unchanged and runs them against an edited scratch copy of `site/`
(nothing in the worktree touched).

Count: **0 CRITICAL, 1 HIGH, 1 MEDIUM, 5 LOW**.

## HIGH

### H1. T7.03 on `/` can't see overflow: every content element is skipped because `.scene` clips
- **Where:** `checks.ts` `overflowProblems` → `clipped()`; `site/index.html:66` `.scene{...overflow:hidden...}`, and
  the phone media query (`site/index.html:248-254`) resets `main` and `.inner` to `overflow:visible` but **not**
  `.scene`.
- **Failure scenario (reproduced):** I put `<div style="width:600px">` and a `<p>` holding a long unbreakable URL
  inside the first `.scene .inner` of `/`, then ran `overflowProblems(page, 375)` (phone context, both font modes).
  Result: `[]`. Every element on `/` except the top bar has `.scene` (overflow-x `hidden`) as an ancestor, so
  `clipped()` skips it. `body{overflow-x:hidden}` stops the page from scrolling, so the scroll checks see nothing
  either. The text is just cut off at 375px and T7.03 passes. This is exactly the SPC-15 bug class (long `<code>`
  tokens). It was caught on `/privacy/` only because that page has no clipping wrapper. All the T7.03 negative tests
  edit `/privacy/`, so this gap is never exercised.
- **Fix:**
  1. In `clipped()`, excuse an element only when an ancestor **can be scrolled** (`overflowX` is `auto` or `scroll`,
     for example the `.bar nav` scroller). Don't excuse it for `hidden` or `clip`, because clipped content is lost
     content. I ran that stricter rule against the real `/` at 375px with vendored and blocked fonts, and it reports
     **zero** problems today (canvas, `.lcd` and the critters all fit). So it costs no allowlist now. If one is
     ever needed, make it an explicit selector list in the test.
  2. Catch text that overflows its own element: for each element with `overflowX === 'visible'`, flag
     `el.scrollWidth > el.clientWidth + 1`, or measure text nodes with `Range.getBoundingClientRect()`. A long
     URL in a 375px-wide `<p>` leaves the `<p>`'s own rect inside the viewport, so the rect check alone misses it.
  3. Add a negative test that injects the 600px div **and** a long unbreakable token into a `.scene .inner` on `/`,
     and assert that both are reported.

## MEDIUM

### M1. The ID check on another page is a substring match on raw HTML
- **Where:** `checks.ts` `linkProblems`: `body.includes(\`id="${fragment}"\`)`.
- **Failure scenario:** suppose `/privacy/` links `/#how` and someone deletes `<section id="how">`. If `id="how"`
  still appears anywhere in the source (a `data-id="how"`, a `<!-- id="how" -->` comment, or a JS string such as
  `querySelector('[id="how"]')`), the link counts as fine and the broken anchor ships. The reverse also happens: an
  id written as `id='how'` or `id=how`, or added by script, is reported as missing even though it works.
- **Fix:** open the target in a second page from the same context, then check `document.getElementById(fragment)`.
  Or parse the fetched HTML with `new DOMParser()` inside `page.evaluate` and query it.

## LOW

### L1. Short links with a trailing slash 404 locally but work on Netlify
- `server.ts` and `linkProblems` match redirects by exact `from === pathname`. Netlify normalizes trailing slashes
  before it matches a redirect, so `/install/` works live. I confirmed that `<a href="/install/">` reports
  `"/install/: HTTP 404"`. This makes the test fail when nothing is broken (it never passes something broken). Fix:
  compare with `pathname.replace(/\/+$/, '') || '/'` in both places.

### L2. A failed assertion leaks the browser context
- Each test calls `await context.close()` after its `expect`. If the `expect` throws, the context, its routes and
  its keep-alive sockets stay open for the rest of the worker. `server.close()` still returns on Node 24, because
  idle sockets are closed. Fix: use `try/finally`, or create the context in a fixture or `afterEach`. The server
  itself is in-process on port 0 and `afterAll` closes it, so there's no port clash and no orphaned process.

### L3. The fallback-font variant gives different results on each OS, and a locally installed face defeats it
- With the stylesheet emptied, layout uses whatever `monospace` resolves to on that machine (Chrome ignores
  `ui-monospace` outside macOS). That is Menlo or Courier on the executor's Mac and DejaVu or Liberation Mono on CI
  Linux. Widths are close (about 0.6em), so the risk is low, but a pass on one OS doesn't prove the other. Also, a
  developer with Press Start 2P or VT323 installed locally renders the real face in "blocked" mode. Then
  `fontProblems` still says "not loaded", so the test passes without testing fallback. Fix (optional): in blocked
  mode, also inject `@font-face{font-family:'VT323';src:local('__none__')}` style overrides, or a stylesheet that
  forces a known vendored fallback, so the measured fallback is the same on every machine.

### L4. `fontProblems` can fail at random if `document.fonts.ready` resolves before loads start
- `openPage` awaits `document.fonts.ready` right after `load`. If Chrome hasn't queued the face loads yet, `ready`
  resolves at once, and `fontProblems` then sees a status of `loading` and fails the test. When this happens the test
  goes red, never green. I didn't reproduce it. Fix if it shows up in CI: call `document.fonts.load('16px "VT323"')`
  and `document.fonts.load('16px "Press Start 2P"')` before checking.

### L5. Links in CSS and SVG aren't collected
- The checker collects `a`, `link`, `script`, `img`, `source`, `iframe` and `srcset`, but not CSS `url(...)`,
  `<use href>`, `video[poster]` or `meta[property=og:image]`. The site uses none of these today, so I checked with
  grep and this is only a note for later. A missing same-origin asset loaded from CSS still shows up through the
  `response` ≥ 400 listener in `openPage`, but only if it loads at phone or desktop width during the test.

## Verified OK (no finding)
- **Network:** every request not on the local origin is fulfilled by `context.route`. `context.request` only ever
  fetches same-origin URLs, with `maxRedirects: 0`, so nothing reaches the real network. Vendored fonts are served
  under `fonts.gstatic.com`, so the live CSP's `font-src` is really applied.
- **Href forms:** relative, `#hash`, `/dir/`, `/dir` (pretty URL), `data:` and `mailto:` are all handled correctly.
  External links are compared as strings only. The `/install` and `/github` short links count as CTAs, and there's
  a test for that.
- **The "blocked" mode really blocks:** the test asserts that both faces are *not* loaded.
- **The SPC-15 CSS fix** (`code{overflow-wrap:anywhere}`, `/privacy/` only): the `<code>` elements are inline in
  normal block flow inside a `max-width:820px` `main`, and the longest token is `chrome.storage.session`. The rule
  only takes effect when a token doesn't fit, so desktop layout is unchanged. `anywhere` and `break-word` only
  differ in min-content sizing, and no shrink-to-fit container is involved here. The rule is scoped to `code` on
  this page, so long words elsewhere aren't affected.
- **CI:** `xvfb-run` is harmless, since these tests use plain headless chromium. With `workers: 1` and port 0 there
  are no collisions.
