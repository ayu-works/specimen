# SPC-20 lens A + contract r1: PR #37 @ dfd3389 (pe-8a, 2026-10-17)

**Verdict: APPROVED.** 0 CRITICAL / 0 HIGH / 0 MEDIUM / 1 LOW (optional).

## Contract (`css.fetch`, owner OK 2026-10-17): conforms
- `CssFetchEntry = string | { skipped: CssSkipReason } | null`, and a bare `null` keeps the old warning text.
- The reasons are a closed set: `no site access`, `not http(s)`, `HTTP <status>` (only `res.status`, never
  `statusText`), `network error`, `over the 24-stylesheet limit`, plus `fetch failed`, which the sampler sets itself
  when the fetcher throws. Fine.
- The sampler re-validates every entry (`skipReasonOf`: the fixed set or `/^HTTP [1-5]\d\d$/`), so even a wrong
  answer can't put free text into a warning.
- `CSS_FETCH_MAX_URLS` is one constant used by both sides. ARCHITECTURE.md is updated.

## Checked
- **Pure move (67eeba6):** the only lines that differ are `export` keywords and imports. The move changes no
  behaviour.
- **Nesting cap:**
  - At `depth >= MAX_NESTING` a container block is skipped. Its body was already found with the iterative
    `matchBrace`, so the walk steps over it and the rules after it are parsed (tested).
  - The cost is at most 32 × length. `MAX_NESTING` is exported.
  - Only container at-rules recurse, so nested style rules can't get around the cap.
- **cssom:**
  - Each sheet is parsed in its own `try`, and a throw becomes `unreadable: <host>` while the next sheet is still
    read.
  - The URLs are deduplicated, and those over the cap are marked seen and warned about.
  - Warnings come out as one per host and reason. The extract step clamps them to the v5 bound (SPC-19), so a
    page with thousands of sheets can't overflow the scan.
- **Thumbnail (my build note 1):**
  - `inFront()` re-reads the tab right before `captureVisibleTab` (using the fresh `windowId`) and again right after
    it. A shot taken while the tab isn't in front is dropped with `screenshot unavailable: the tab was not in front`.
  - The scan itself is kept, and saving it writes no thumb row. Tests cover not in front, going to the background
    during the capture, and the tab closing after sampling.
- **friendlyScanError:** the ordering is right. Chrome's own `chrome://` and Web Store texts are matched first,
  `Unsupported page` (from runScan, which includes the URL) gets "only websites", and an unknown message keeps
  `Scan failed: <msg>`.
- **Can the tests fail?** In the PE worktree at dfd3389:
  - with `cssText.ts` and `cssom.ts` from de35272: `cssText.test` fails 2 of 10 (the old code throws a `RangeError`)
    and `cssom.test` fails 5;
  - with `backgroundScan.ts` and `scanFlow.ts` from the pure-move commit: `scanFailures.test` fails 22 of 44 (every
    new mapping, the capture-time check and each skip reason).

## LOW
### L1. A restricted-page check can fire on a file path
`friendlyScanError` tests `/chrome:\/\/|chrome-extension:\/\/|extensions gallery|webstore/i` before
`Unsupported page`. So `Unsupported page: file:///Users/x/webstore-notes.html` gets the chrome:// / Web Store text
instead of "only websites". Only the wording is wrong. Fix (if wanted): check `Unsupported page` first, and map it
by its URL's scheme (`chrome:` or `chrome-extension:` → the restricted text; anything else → only websites).

## Fold check (pe-4d, 2026-10-17): lens B r1 fold @ 64a0ee9, APPROVED (1 optional LOW)
- **H1:** the `split('{')` pass gives the same segments as `/[^{}]*\{/g` (each `{` back to the previous `}`; `{{`
  gives two empty selectors in both). The `walkText` `;` cache still holds the first `;` ≥ `i` (no `;` in
  [i', semi) ⇒ none in [i, semi)), so its behaviour is unchanged. Probe with 9 more hostile 2 MB shapes the table
  lacks (a 2 MB selector before `{`: theme, `:hover`, plain; a 2 MB `@media` prelude; `@` with no `;`; an open quote;
  200k `.dark a{}`; a decl block with no `;`): each runs in 36–238 ms, with no warnings.
- **M1:** with the `sameUrl` line mutated out, the new navigation test goes red. All NoShot/`noShotReason` texts are fixed.
- **M3:** `fetch failed` has left the wire type and `FIXED_REASONS`, and is now only the sampler's own fixed text.
  The contract matches the owner OK.
- L1 (one aggregate warning, ≤ 3 host names), L3, L4, L5: fine. `scanFailures` + `cssom` 75/75 on 64a0ee9.

### L1 (optional). `inFront` skips the URL check when `tab.url` is hidden
`if (tab.url && !sameUrl(...))` lets the shot through when Chrome hides the URL. Today `captureVisibleTab` would
fail on such a page anyway (no host access ⇒ no capture), so this has no effect now. **Fix:** fail closed with
`if (!tab.url || !sameUrl(tab.url, url))`. A page we could scan always has a visible URL, so this costs nothing.
