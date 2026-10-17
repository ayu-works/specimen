# SPC-20 review: lens B + security, round 1

PR #37 (`exec/spc-20`, 3 commits on de35272). Reviewer: fresh lens-B session, read-only.
Checked: `gh pr diff 37`, the handoff, the Linear comments (PE ruling + owner OK), audit H8/H9/H11/M9, and the
CLAUDE.md rules. Ran `vitest` on `scanFailures`, `cssom` and `cssText` (69/69 green). Timed `parseCssText` on hostile
2 MB inputs with node 24 (strip-types).

**Count: 0 CRITICAL · 1 HIGH · 3 MEDIUM · 5 LOW.**

## Verified OK (no action)
- **Nesting cap is bounded and changes nothing below the cap.** The only behaviour change in `walk()` is the
  `container && depth >= 32` skip. The skipped block is still stepped over by the `matchBrace` that already ran, so
  later rules parse (tested). Worst cases at about 2 MB: 222k balanced `@media a{` took 1.03 s, the same unbalanced
  took 0.64 s, 31 levels deep plus 130k sibling rules took 0.75 s, and `@media (` × 222k took 0.08 s. All 32
  mediaQueries were recorded. Memory is 32 slices of the body at most. `@font-face` at any depth behaves as before.
- **css.fetch can't reach hosts without permission.** The URL is parsed first, then http(s) only, then
  `permissions.contains` for that exact origin before any `fetch`. The fetch uses `credentials: 'omit'`. Items past
  index 24 are answered with no `new URL` and no fetch. Only extension contexts can send `onMessage`. There is no
  `externally_connectable`, and the sampler runs in the isolated world.
- **Reason strings are fixed.** `HTTP ${res.status}` is a number. `skipReasonOf` re-validates the reason on the
  sampler side (fixed set plus `/^HTTP [1-5]\d\d$/`), and anything else falls back to the bare-host warning. No
  statusText, body or URL path reaches a css warning (the host only, as before).
- **An old `null` (or a short array, or `undefined`) still gives the exact old text** `cross-origin stylesheet
  skipped: <host>`.
- **24 cap:** enforced in both places from one constant. Past-cap URLs are marked `seen` and warned once.
- **A failed screenshot keeps the scan.** It is caught, warned, `screenshot: ''`, and `saveScan` writes one scan row
  and zero thumb rows (unit and e2e). The capture is skipped when the tab isn't in front, and re-checked after.
- **Error texts:** none of the new mappings turns a failure into a success-looking message.

## HIGH

### H1. A hostile cross-origin sheet can still hang the scan forever (pre-existing regex, the same threat as H11)
`apps/extension/src/sampler/cssom.ts:216`: `for (const m of text.matchAll(/[^{}]*\{/g)) noteThemeSelectors(...)`
runs on every fetched sheet. When there is a long run without a `{`, each start position scans to the next `}` (or to
the end), fails, and the engine retries one character later. That makes it O(n²).
- **Measured:** 20k chars took 0.43 s, 40k took 1.24 s and 80k took 5.1 s. A single `.match` on a 2 MB
  `'a'.repeat(2e6)+'}'` was still running after 120 s. `MAX_CSS_BYTES` lets 2 MB through.
- **Scenario:** a page links a cross-origin sheet whose body is 2 MB of `a` (or any long brace-free tail). The
  background fetches it (the user granted `<all_urls>`), then the sampler blocks inside `executeScript`, and
  `scan.run` never resolves. The panel spins with no error. Nothing throws, so the new per-sheet `try` doesn't help.
- This is worse than the RangeError this PR fixes: that one is now a warning, while this one has no end. The PR's
  claim "one hostile sheet must not fail the scan" holds only for throws.
- **Fix:** replace the regex with a linear pass. Example: `for (const seg of text.split('{').slice(0, -1))
  noteThemeSelectors(seg.slice(seg.lastIndexOf('}') + 1) + '{', acc)`. Add a unit test in `cssom.test.ts` that feeds
  a fetcher 2 MB without braces and asserts it finishes in under 1 s. The fix is one line in a file this PR already
  touches; whether it goes here or in a follow-up ticket is the orchestrator's call. If it is split out, state that
  limit in the handoff.

## MEDIUM

### M1. A tab navigated mid-scan still gets a thumbnail of a different page (the same class as fix 3)
`backgroundScan.ts` `scanRun` checks only `tab.active` before and after the capture. Suppose the user clicks a link
(or the page redirects) after the sample and before `captureVisibleTab`. The tab is still active, so the shot shows
page B, while the saved scan (`raw.url`) is page A. The Library then shows A's tokens under B's picture: a quiet wrong
result.
- **Fix:** in `inFront` (or next to it), also require `sameUrl(tab.url, raw.url)` (`scanFlow.sameUrl` already ignores
  hash, query order and a trailing slash; move it to a shared lib). Otherwise warn `screenshot unavailable: the page
  changed during the scan`. Add a unit test with `tabs.get` returning a different `url` on the post-capture call.

### M2. The most likely "background stopped mid-scan" text isn't mapped
The service worker dying *while* `scan.run` is in flight (an idle kill, an extension reload or update) rejects
`sendMessage` with `The message port closed before a response was received.` (or `A listener indicated an
asynchronous response by returning true, but the message channel closed before a response was received`). It does not
reject with `Receiving end does not exist`, which only happens when there is no listener at send time.
`friendlyScanError` maps neither, so the user sees `Scan failed: The message port closed…`. That is not misleading,
but it is the M9/H8 scenario the PR claims to handle, and the clear text goes unused.
- **Fix:** add `message port closed|message channel closed` to the background-stopped regex, plus a row in the
  `friendlyScanError` table test.

### M3. `fetch failed` is a sixth skip reason outside the owner-approved set and outside ARCHITECTURE §8
The owner OK (Linear, 2026-10-17) and ARCHITECTURE §8 list five reasons. `CssSkipReason` and `FIXED_REASONS` in
`messaging.ts` add `'fetch failed'`, used by `cssom.ts` when `fetchCss` throws. It is a fixed string, so there is no
leak. But the frozen contract and the docs now disagree, and the background is typed as allowed to send it.
- **Fix:** either (a) keep it sampler-only: don't put it in the wire type `CssSkipReason`, and push the warning
  directly when `fetchCss` throws; or (b) add it to the ARCHITECTURE row and get a one-line PE/owner ack. (a) needs no
  contract change.

## LOW

### L1. Past-cap hosts make one warning each, and the 100-warning trim can then drop the screenshot warning
`cssom.ts` adds `${host} (over the 24-stylesheet limit)` for every distinct host past the cap. Before this PR those
were dropped silently. A page with a few hundred cross-origin hosts produces hundreds of warnings. `extract` trims to
`BOUNDS.warnings = 100` and keeps the first ones, so `screenshot unavailable: …` (pushed last, by the background)
silently disappears.
- **Fix:** make it one aggregate warning per round, `N cross-origin stylesheets over the 24-stylesheet limit`, with up
  to 3 hosts named.

### L2. The e2e 20k test doesn't rule out the catch path
`T1.12 real background…` passes when the cap works. If `parseCssText` threw instead, `--after-deep` would be missing,
so the test does fail in that case. But nothing asserts the sheet wasn't reported `unreadable`, and nothing shows the
e2e being red on `main` (only the core unit test was). Add
`expect(raw.warnings.some(w => w.includes('unreadable'))).toBe(false)`.

The `sec-fetch-dest` split is sound: the page still loads a cross-origin sheet whose CSSOM is unreadable, so the URL
is queued, and the real background fetch plus the real sampler bundle parse the deep text. The test stays meaningful
end to end for the extension's code path. It just can't cover Chrome's own renderer.

### L3. The screenshot warning still carries Chrome's raw message
`screenshot unavailable: ${e.message}` is pre-existing. For a revoked permission mid-scan, Chrome's text can include
the page URL (`Cannot access contents of url "https://…"`). That is not a leak, since it stays in the user's own
scan, but it is inconsistent with the fixed css reasons, and the raw message lands in exported scans.
- **Fix (optional):** map it to a few fixed texts (`no site access`, `the tab was not in front`, `capture failed`).

### L4. `friendlyScanError` tests the whole message, URL included
`Unsupported page: ${tab.url}` and Chrome's `Cannot access contents of url "<url>"` embed the URL, and the first
regex matches `webstore|chrome://` anywhere in it. So `file:///…/webstore-notes.html` gets the chrome:// / Web Store
text, and so does a permission error on `https://example.com/webstore/`.
- **Fix:** check the `Unsupported page` prefix before the chrome:// regex, and match `webstore` only as the host
  (`chromewebstore.google.com|chrome.google.com/webstore`).

### L5. The chrome:// unit case can't occur in real Chrome
There is no `tabs` permission, and `<all_urls>` doesn't cover `chrome://`, so `tab.url` is `undefined` for
`chrome://settings`. `runTabScan` therefore sends `scan.run`, and the real error is `Cannot access a chrome:// URL`
from `executeScript`. The test stubs a visible `url` and asserts that no `scan.run` is sent, which drives a path real
users never take. The real path still yields the right text.
- **Fix:** add a case with `url: undefined` and `scan.run → {ok:false, error:'Cannot access a chrome:// URL'}`.
