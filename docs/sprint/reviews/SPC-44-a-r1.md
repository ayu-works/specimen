# SPC-44 lens A r1 (PE pe-b2, 2026-10-17)

PR #43 @ 3fc5685, base `exec/spc-28` (on top of its head eb81e1a). I ran themeCapture + mobileCapture + manifest
here: 34/34 green. The CI gate was pending when I checked.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 1 LOW.**

## Checks
- **Permissions (ARCH §10):** the prod and e2e manifests both drop `debugger`. Pinned three ways: T0.03 unit
  (`optional_permissions` undefined, no "debugger" anywhere in the manifest), T0.03 e2e on `.output-e2e`, and the
  release.yml check now covers `optional_permissions` too. `optional_host_permissions` is unchanged. No static content scripts.
- **The protocol change is safe for an old caller:** the `emulate` test boots the real background entrypoint and
  sends `scan.run` through its `onMessage` listener. The reply is `ok`, `emulate` isn't forwarded to the sampler
  (backgroundScan.ts:44 lists only `theme`/`colorsOnly`/`skipComponents`), and `chrome.debugger` is never read.
- **Nothing left that always fails:** every remaining reference to `debugger` in the repo is a guard or a test
  (`git grep`). The `MobileSkipReason` union shrank to `fullscreen | tabbed`, and `SKIP_NOTES` is keyed by it, so
  TypeScript catches a missing note.
- **Removing the lock is sound:** `withTabEmulation`/`tabEmulationIdle` only guarded a phone override in the user's
  tab, and nothing writes one now. Recovery still closes a leftover popup and clears the legacy
  `mobile.emulatingTab` key without touching any debugger API (tested).
- **Captures:** `captureMobile` in full screen → `MobileSkippedError('fullscreen')`. A popup wider than 480 →
  `MobileTooWideError`, and nothing is stored. `finally` closes only what the capture created (unchanged). `captureTheme`
  returns null unless `themeApplied`, as the `class` path did before.
- **Data:** no `DesignScan` change; `Extras` is in memory only, so `offer` → `system` needs no migration.
- **T5.03 e2e:** the oracle doesn't depend on the code under test, and CI asserts the capture path ran (≤ 480).
  The sampler's `viewport.w` and the oracle both use `window.innerWidth`, so they measure the same thing.

## LOW
### L1. The e2e expects exactly the oracle's width; the plan said ±2
`expect(width).toBe(oracle)` and the `${oracle}px` text match need the two popups to come out exactly the same width. On
most hosts they will. A window manager that rounds the two creates differently would make CI red with no bug behind it.
**Fix (optional):** `expect(Math.abs(width - oracle)).toBeLessThanOrEqual(2)`, and match the text with
`/captured[^\n]*(\d+)px/` against `width`. No re-review needed.
