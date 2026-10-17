# SPC-20 handoff: scan failure paths (audit H8, H9, H11, plus M9)

Executor session `spc-20-04`, branch `exec/spc-20` from `origin/main` de35272. PE `pe-8a`, orchestrator `specimen-6a`.

## Plan (APPROVED by PE 2026-10-17; css.fetch change OK'd by the owner via the orchestrator)

Goal: every scan failure a user can hit gives a clear message and never a misleading success, and a test drives each
one. No test touches a real URL: `fetch`, `chrome.*` and the sampler are stubbed (unit), or served from the local
fixture server / `page.route` (e2e).

### Real bugs found while reading (fixed here)
1. **Deep-nesting crash (H11).** `packages/core/src/cssText.ts` `walk()` recurses once per `@media`/`@supports`/…
   block. 20k nested `@media` → `RangeError`, and `collectCssom` (`sampler/cssom.ts:211`) calls `parseCssText` with
   no catch, so one hostile cross-origin sheet fails the whole scan. Even without the crash, each level re-runs
   `matchBrace` over its body, so deep nesting is O(depth × length).
   **Fix:** a nesting cap (`MAX_NESTING = 32`): deeper blocks are skipped without recursing (cost ≤ 32 × length).
   Plus defence in depth in `cssom.ts`: each fetched sheet is parsed in its own `try`, and a throw becomes the warning
   `cross-origin stylesheet unreadable: <host>` instead of failing the scan.
2. **One warning for every reason (H11).** `background.ts` `cssFetch` returns `null` for no permission, a non-http
   URL, an HTTP error, a network error and over-the-cap alike, so the user can't tell "grant access" from "the site
   404s". **Fix:** an entry can be `{ skipped: reason }`. Warning becomes
   `cross-origin stylesheet skipped: <host> (<reason>)`, reasons `no site access` · `HTTP 404` · `network error` ·
   `not http(s)` · `over the 24-stylesheet limit`. A bare `null` (old fake fetchers, no fetcher) keeps today's exact
   text `cross-origin stylesheet skipped: <host>`. The 24-URL cap exists twice (`MAX_CSS_URLS` in background,
   `MAX_CROSS_ORIGIN` in cssom): both read one exported constant so they can't drift.
3. **A thumbnail of the wrong tab (H9).** `captureVisibleTab(windowId)` captures whatever tab is in front. If the
   scanned tab isn't the active tab of its window, the Library thumb shows another page: a quiet wrong result.
   **Fix:** `scanRun` skips the capture when `!tab.active` and records `screenshot unavailable: the tab was not in
   front`; the scan is still extracted and saved, without a thumb row.
4. **Raw or wrong error texts (H8, M9).** `friendlyScanError` today:
   - A tab closed mid-scan gives `Scan failed: No tab with id: 7.` → **"The tab was closed before the scan finished."**
   - The service worker gone or restarted (`Could not establish connection. Receiving end does not exist.`, or
     `no response for scan.run`) → **"Specimen's background worker stopped. Click Scan again."**
   - A failed injection: `Cannot access contents of …` / `Missing host permission` → the site-access message; `Frame
     … is showing error page` → **"This page didn't load. Reload it and scan again."**; `sampler returned no result` →
     **"Couldn't read this page. Reload it and scan again."**
   - `permissions.request` outside a gesture (`must be called during a user gesture`) → the "Click Scan again and
     choose Allow" message.
   - `file://`, `about:`, `view-source:` and similar currently get the chrome:// / Web Store text, which is wrong for
     them → **"Specimen can only scan websites (http or https)."** chrome://, chrome-extension:// and the Web Store
     keep today's text.

Not changed: on a failed scan the panel keeps showing the *previous* scan's card under the red alert. That's existing
behaviour (Scan.tsx, not mine) and the alert is unambiguous; flagging it for the PE/orchestrator rather than changing it.
SPC-28 (`waitForTabLoad` race) is left alone. H10/M10 (debugger emulation) are out of scope.

### Files
- `packages/core/src/cssText.ts` (+ `cssText.test.ts`): nesting cap.
- `apps/extension/src/lib/backgroundScan.ts` (new): `scanRun`, `sample`, `downscale`, `withColorSchemeEmulation`,
  `cssFetch` and `ensureOffscreen` moved out of `background.ts` unchanged except fixes 2–3, so they can be
  unit-tested with a fake `chrome`. `background.ts` keeps only wiring.
- `apps/extension/src/lib/messaging.ts`: `css.fetch` res type `texts: (string | { skipped: string } | null)[]`
  (additive, old `null` still valid) and the shared `CSS_FETCH_MAX_URLS = 24`. **Protocol change: PE ruling needed.**
- `apps/extension/src/sampler/cssom.ts`: per-sheet `try`, reason-aware warnings, shared cap.
- `apps/extension/src/lib/scanFlow.ts`: `friendlyScanError` cases above. `saveError` from #33 untouched.
- Tests: `apps/extension/test/scanFailures.test.ts` (new), `apps/extension/test/helpers/chrome.ts` (add
  `scripting`/`captureVisibleTab`/`tabs.get` stubs, defaults unchanged), `e2e/sampler.spec.ts` (T1.12 cases),
  `e2e/phase4.spec.ts` or a new block for the background-tab e2e.

### Tests (T-IDs from docs/TESTING.md: T1.11 scan.run, T1.12 cross-origin, T4.08 save)
Core (tests first):
- `T1.12 parseCssText survives 20k nested @media` — no throw, < 1 s, the first 32 queries are recorded; fails on
  today's `main` with RangeError.
- `T1.12 vars inside @media nested under the cap are still found`, and one just over the cap is dropped (pins the
  cap's behaviour).

Extension unit (`scanFailures.test.ts`, jsdom + fake-indexeddb, all `chrome`/`fetch` stubbed):
- `T1.11 friendlyScanError` table: every input above → its text; an unknown message → `Scan failed: <msg>`.
- `T1.11 runTabScan` driven through the store, each asserting `status: 'error'`, the exact error text, and that no
  Library row was written: `permissions.request → false`; a `chrome://settings` tab (no `scan.run` sent); a
  `file:///` tab; the Web Store (`scan.run` → `{ok:false, error:'The extensions gallery cannot be scripted.'}`); tab
  closed (`No tab with id: 7.`); background gone (`sendMessage` rejects `Receiving end does not exist`, and
  resolves `undefined`); no active tab.
- `T1.11 scanRun` (backgroundScan): `captureVisibleTab` rejects → `screenshot: ''` + warning, and feeding that result
  through `scanTab` saves one scan row and **zero** thumb rows; `tab.active: false` → capture never called, same
  outcome; `executeScript` rejects → `scanRun` rejects (no half result); `tabs.get` rejects → rejects;
  `noScreenshot` → no capture.
- `T1.12 cssFetch`: `contains → false` → `{skipped:'no site access'}` and `fetch` never called; 404 → `HTTP 404`;
  `fetch` rejects → `network error`; `ftp:`/`data:` → `not http(s)`; 25 URLs → 24 fetches, the 25th
  `over the 24-stylesheet limit`; a 3 MB body → exactly 2,000,000 chars. `fetch` is `vi.stubGlobal`.
- `M9`: `send` when `sendMessage` rejects / resolves `undefined` / `{ok:false}` throws the right message; `listen`
  answers an unknown type with `not implemented: x`; `ensureOffscreen` with `getContexts → [{}]` creates nothing, a
  "single offscreen document" race returns `false`, any other `createDocument` error rethrows.

e2e (Playwright, local servers only):
- `T1.12` existing cases keep passing (bare `null` → old text). New: a fetcher returning
  `{skipped:'no site access'}` and one returning `{skipped:'HTTP 404'}` give distinct warnings; a fetcher that
  throws → warning, scan succeeds; a fetcher returning 20k-nested `@media` text → scan succeeds (the crash path end to
  end, through the real sampler bundle).
- `T1.11 a background-tab scan`: fixture tab not in front (another local page is), panel scans it → scan shown,
  saved to Library, no thumbnail, warning recorded. Real Chrome, so it also proves the `tab.active` check.

### Failure modes considered
- **Partial failure:** screenshot fails after a good sample → scan kept, saved without a thumb (one transaction in
  `saveScan`, so never a thumb without a scan). Sample fails → nothing saved, error shown. Save fails → `saveError`
  (#33), unchanged.
- **Misleading success:** wrong-tab thumbnail (fix 3); one sheet's parse crash failing everything (fix 1); a 404
  reported as "needs permission" (fix 2).
- **Drift:** the 24 cap in two places → one constant; reasons ride in the same array entry as the text (no parallel
  array that could go out of step).
- **Back-compat:** old `null` entries and old fake fetchers still work, with the old warning text.
- **Cleanup errors:** the debugger detach path is unchanged and caught (H10 is another ticket).
- **Concurrency/idempotency:** no new state; `ensureOffscreen` race is the existing catch, now tested.

### Check
`pnpm gate` green. The core nesting test is shown failing on `main` first.

## Done
- Plan approved with PE notes, all applied: (1) skip reasons are a closed union of fixed strings, HTTP gives the
  status number only (`skipReasonOf` also rejects anything outside the set on the sampler side); (2) `tab.active` is
  checked right before and confirmed right after the capture, with a test where the tab goes to the background
  mid-capture; (3) the move to `lib/backgroundScan.ts` is its own pure-move commit (67eeba6); (4) a rule after the
  20k-deep block is shown parsed (core and e2e); (5) `test/helpers/chrome.ts` untouched (the extra stubs live in the
  test file).
- Core nesting cap (`MAX_NESTING = 32`); its test failed on `main` with RangeError first.
- Error texts, per-sheet `try` in `cssom.ts`, reason-aware warnings, the shared 24 cap (sheets past it now get a
  warning instead of being silently dropped, and duplicate URLs in one round are fetched once).
- Tests: `apps/extension/test/scanFailures.test.ts` (H8 table + runTabScan failures, H9 screenshot paths incl.
  the real `saveScan` with zero thumb rows, css.fetch reasons/cap/2 MB, M9 messaging + ensureOffscreen),
  `apps/extension/test/cssom.test.ts` (warnings per reason, out-of-set reason, throwing fetcher, 20k nesting, a
  parse that throws, the cap), and two e2e in `e2e/sampler.spec.ts` (a tab behind the panel: saved, no thumb, the
  warning; the real background: `HTTP 404` warning and a 20k-deep sheet).
- Finding: Chrome's own renderer crashes on a 20k-deep sheet ("Page crashed"), so the e2e server sends the deep text
  only to the background's fetch (`sec-fetch-dest` is not `style`) and a plain sheet to the page.
- ARCHITECTURE §8 `css.fetch` row updated. `pnpm gate` green.

- PR #37. Lens A r1 (pe-8a): APPROVED, 0C/0H/0M, 1 LOW folded in 292804a (an unsupported page is judged by its
  scheme only); the fold was approved too. pe-8a handed over; the new PE is pe-4d. After lens B, send the head commit to pe-4d and specimen-6a.

- Lens B r1 (`SPC-20-b-r1.md`, 0C/1H/3M/5L), all folded:
  - **H1** the theme-selector regex `/[^{}]*\{/g` in `cssom.ts` was O(n²) (a 2 MB brace-free sheet hung the scan).
    It's now a linear `split('{')`. The same class of bug was in `states.ts` `walkText` (an `indexOf(';')` per rule,
    O(n²) on a sheet with no `;`): `;` is now searched again only once passed. There's a table test over 9 hostile
    2 MB inputs through `collectCssom` (< 3 s each, all < 0.5 s measured); on the old code the run hangs past 120 s.
  - **M1** the thumbnail also needs the tab still on the scanned page (`sameUrl(tab.url, raw.url)`; `sameUrl` moved
    to `lib/sameUrl.ts` and is re-exported from `scanFlow`). **M2** "message port/channel closed" maps to the
    background-stopped text. **M3** `fetch failed` is sampler-only (out of the wire type), so the contract matches
    ARCHITECTURE §8 and the owner OK.
  - **L1** sheets past the cap give one aggregate warning naming up to 3 hosts. **L2** the e2e asserts no
    `unreadable` warning. **L3** screenshot warnings are fixed texts (`the tab was not in front`, `the page changed
    during the scan`, `the tab was closed`, `no site access`, `capture failed`). **L4** was already folded in
    292804a, plus a row for a `/webstore/` path in a permission error. **L5** adds a chrome:// tab with no visible url.

- pe-4d fold check APPROVED @ 64a0ee9, with 1 optional LOW, taken: `inFront` fails closed when `tab.url` is hidden
  (`screenshot unavailable: no site access`, with a test). No re-review is needed for that.

## Next
- Done unless the owner's manual test finds something. Merge is the owner's call.

## How to resume
Read this file, `git log origin/main..`, the PR, then any `docs/sprint/reviews/SPC-20-*.md`.
