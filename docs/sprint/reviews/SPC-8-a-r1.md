# SPC-8 lens A review, round 1 (PE, 2026-10-14)

PR #19, commit ae1a6b7. Scope: `apps/extension/e2e/site/*` (server, netlify parser, checks, spec, vendored fonts)
and the one-line SPC-15 fix in `site/privacy/index.html`.

**Result: 0 CRITICAL · 1 HIGH · 0 MEDIUM · 3 LOW.**

Checked and fine:
- The CSP and redirects are read from netlify.toml in one place. The server sends the headers on every response, and
  CSP violations plus console errors are collected. The negative test for a CSP-blocked asset asserts the exact
  directive.
- Negative tests assert exact messages, and the fixture edits throw if their anchor text is missing, so a silent no-op
  edit can't pass.
- The font check is not vacuous: the fallback run asserts both faces are reported missing.
- No request leaves the machine (context.route fulfils every non-origin request). The temp dir and server are cleaned
  up in afterAll. A path escape returns 404, and a malformed `%` escape returns 404 (caught).
- The SPC-15 fix is scoped to `code{overflow-wrap:anywhere}`, and the fallback-font T7.03 now passes on both pages
  with no fixme.
- Lane ownership: only the agreed folder and the orchestrator-approved site/ line are edited.

## HIGH

**H1. On `/`, the T7.03 per-element check skips every content element, so the masked-overflow case it exists for
can't fail there.**
- `checks.ts` `clipped()` skips an element when any ancestor below body has `overflow-x` other than `visible`. On
  `site/index.html`, `.scene{…;overflow:hidden;…}` is **not** reset in the phone media queries (only
  `width/height/min-height` are), and every section's content sits inside a `.scene`. So at 375px every element on
  `/` is inside a clipping ancestor and is skipped.
- What's left is the scrollWidth/scrollX checks, which are exactly the ones that `body{overflow-x:hidden}` (and
  `.scene` itself) mask.
- The negative test injects its too-wide `div` only into `privacy/index.html`, which has no clipping wrapper, so this
  never shows up.
- *Failure scenario:* a long unbreakable string or a fixed-width card inside a section on `/` runs to 500px. At
  375px `.scene` cuts it off, so the user sees truncated content. T7.03 `/` stays green.
- *Fix:* skip an ancestor only when it is a **scroll container** (`overflow-x` is `auto` or `scroll`), because that
  content is reachable by scrolling. A `hidden` or `clip` ancestor cuts content off, so keep checking the element
  against the viewport (or against the ancestor's own visible rect). If that flags intentional decoration (the
  scene canvas or sprites, `.lcd` pre text, `.sr`), exclude those by an explicit, commented selector list, not by
  the generic rule. Add a negative case on **`/`**: inject a `div` with `width:500px` inside the first `.scene .inner`
  and assert it's reported.

## LOW

**L1. Cross-page fragment check is a substring match.** `linkProblems` checks `body.includes(\`id="${fragment}"\`)`.
`data-id="how"` or the text `id="how"` inside a `<code>` block satisfies it, and `id=how` or `id='how'` fails it. Fix:
parse the fetched page (`new DOMParser()` inside `page.evaluate`, then `getElementById`).

**L2. The vendored stylesheet replaces whatever Google Fonts URL the site requests.** A typo in the site's
`family=` parameter (e.g. `family=VT32`) still gets both faces, so a live-site font break would pass. Fix: in
`isolate`, record the googleapis request URL and have `fontProblems` (or a T7.01 assert) check that it names both
`Press+Start+2P` and `VT323`.

**L3. `/privacy` without the slash doesn't behave like Netlify.** By default Netlify's pretty URLs answer `/privacy`
with a 301 to `/privacy/`, while the local server serves 200 at `/privacy`. Relative hrefs then resolve differently
from production. That's harmless today (all hrefs are root-absolute), but it's drift between the two copies. Fix
(optional): 301 a directory path without its trailing slash, and have the `/privacy` test follow the redirect and
assert it lands on `/privacy/`.
