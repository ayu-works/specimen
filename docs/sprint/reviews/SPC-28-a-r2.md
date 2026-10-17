# SPC-28 lens A r2: fold check of lens B r1 (PE pe-b2, 2026-10-17)

Diff 8642a9d..6ab4435 (`waitForTabLoad(id, {url})`, the host-access gate, abandoned-navigation reject, test rework,
mobileCapture stub `url: PAGE`). `waitForTabLoad.test.ts` + `mobileCapture.test.tsx`: 51/51 green here.

**Verdict: 0 CRITICAL · 0 HIGH · 1 MEDIUM · 0 LOW.** The M1 fold is sound. The `ready` gate is safe: an event
dropped before the host-access answer is seen by the read that follows. `visible` only ever goes false → true, and every exit
still goes through `done()`. One regression comes from the L1 fold.

## MEDIUM

### M1. A redirect to an origin without host access now fails with a false "didn't open a page"
Host access is per origin (`optional_host_permissions`, granted by `ensureSiteAccess`). Say a Library rescan of
`https://a.com` (granted) gets redirected to an origin that isn't granted (a consent or login page on another domain,
`a.com` → `www.a.com`, a locale domain). Reads go `pendingUrl: https://a.com/` (visible, so `pendingSeen`), then the
committed page with `url: undefined` (hidden, because that origin isn't granted). With `visible === true` a hidden url
counts as blank, so after 4 `complete` reads the wait rejects with "The address did not open a page". The user sees
"This address didn't open a page (it may be a download)". That's wrong, and it hides the real fix: grant access to the
new site. Before this fold (and on main), the wait resolved, `scanTab`'s injection failed with "Cannot access
contents", and the user got the accurate SITE_ACCESS message. Mobile capture has the same problem ("Mobile capture
skipped: This address didn't open a page").
**Fix (recommended):** once `blankReads >= ABANDONED_READS`, **resolve** (`done()`) instead of rejecting, and let
`scanTab` say what the tab really is: about:blank gives "Unsupported page" → "can only scan websites" (the accurate text lens
B's L1 wanted back), and an origin without access gives SITE_ACCESS. That still fails fast (~2 s) with no
`friendlyScanError` branch to maintain (drop "did not open a page"). Test: reads `{loading, pendingUrl: PAGE}` → 4×
`{complete, url: undefined}` with host access → resolves (not "took too long", not stuck). Keep the existing
"blank before any pending navigation is waited on" test. Rename the abandoned test to say it resolves and leaves
the verdict to the scan.
(Alternative: keep the reject but word it to cover both cases, e.g. "didn't open a page Specimen can read (a download,
or a redirect to a site you haven't allowed)". That's worse: the user can't tell which, and the grant button never shows.)

Notes: M2 evidence (T5.03 20/20 ×3) is recorded in the handoff, good. L2 out of scope is acceptable (preexisting).
Your `docs/sprint/handoffs/SPC-28.md` has uncommitted edits; commit them with this file.
