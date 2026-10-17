# SPC-44: remove the `debugger` permission (owner option B)

Executor `spc-44-4d` · branch `exec/spc-44` (stacked on `exec/spc-28` eb81e1a, PR #39) · PE `pe-b2` · orchestrator `specimen-75`.
Status: **built, `pnpm gate` green, PR open.** Plan approved by pe-b2 on 2026-10-17.

## Plan

### Why
Chrome refuses `debugger` in `optional_permissions` ("Only permissions specified in the manifest may be requested"),
so for every real user the dark "media" capture and the mobile "Capture with permission" / "Capture in this tab"
paths always fail. The owner chose B (2026-10-17): remove `debugger` completely. Kept, with no permission: mobile via
the temporary popup window, dark/light via the page's own class switch.

### Code changes (all removals, plus honest UI text)
| File | Change |
|---|---|
| `apps/extension/wxt.config.ts` | Drop `optional_permissions` and the e2e `debugger` pre-grant (and their comments). The e2e build then has the same permissions as prod, except its existing `<all_urls>` host grant. |
| `src/lib/messaging.ts` | `ScanOpts` loses `emulate`. |
| `src/lib/backgroundScan.ts` | Delete `withColorSchemeEmulation`; `scanRun` always calls `sample`. An old caller that still sends `emulate` gets an ordinary (non-emulated) sample: the field is ignored, never an error. |
| `src/lib/captureFlow.ts` | Delete `AttachError`, `hasDebugger`, `sampleEmulatedPhone`, `emulateInTab`, `requestDebugger`, the `emulate` opt of `captureMobile`, and `captureTheme`'s `how` param (class switch only). `phoneSample` becomes "popup width ≤ 480 or `MobileTooWideError(width)`". Full screen always throws `MobileSkippedError('fullscreen')`. `MobileSkipReason` loses `attach`. Header comment rewritten. |
| `src/lib/tabEmulation.ts` | Keep only the popup recovery (`rememberMobileWindow`, `recoverMobileCapture`). Delete `withTabEmulation`, `tabEmulationIdle`, `rememberEmulatedTab` and the debugger detach. Recovery still **removes** the legacy `mobile.emulatingTab` session key, so a leftover from an old version is cleared (no debugger can be attached any more: Chrome detaches on extension update/reload). Doc comment updated. I keep the file name to keep the diff small (rename to `mobileRecovery.ts` if the PE prefers). |
| `src/lib/scanFlow.ts` | Two lines: drop the `tabEmulationIdle` import and `await tabEmulationIdle()` (it only guarded against reading the phone override in the user's tab, which no longer exists). #39 owns this file but I'm stacked on it; **PE: OK to touch these two lines?** Alternative: leave `tabEmulationIdle` as a resolved no-op, which is dead code. |
| `sidepanel/extras.ts` | Delete `runMediaCapture`; `runMobileCapture(scan)` loses `withPermission`. `SKIP_NOTES` loses `attach`; `fullscreen` note becomes "Mobile capture is skipped in full screen. Exit full screen, then try again." `runThemeCapture`: a page that only has `@media (prefers-color-scheme)` gets theme state `system` (was `offer`). |
| `sidepanel/store.ts` | `Extras.theme`: `offer` → `system`; comments on `wide`/`mobileSkip` no longer mention the debugger. In-memory only (not persisted), so nothing stored to migrate. |
| `sidepanel/views/Scan.tsx` | Remove "Capture with permission" and its debugger note. `wide`: row "not captured (Chrome kept the window too wide)" and no button. `skipped`: the button is always "Try again" (plain `runMobileCapture(scan)`), never "Capture in this tab". Theme `system`: row reads "follows your system setting · not measured" with no button, and a short note that the derived variant is used. "Capturing mobile…" always says "a small window opens". |
| `.github/workflows/release.yml` | Manifest check fails on `debugger` in `permissions` **or** `optional_permissions`. |

### Old data (migrate / repair path)
- `DesignScan` has no `emulate`/`media` field; `variants.dark|light` with `measured: true` stay valid, so **no schema
  change and no `schemaVersion` bump**. I'll grep `packages/core/src/schema` + `migrate` to confirm and add nothing.
- `RawHints.prefersScheme` stays (it now drives the `system` row).
- Settings: the only capture setting is `settings.captureMobile` (unchanged). No stored setting mentions emulate/media.
- `chrome.storage.session` `mobile.emulatingTab` from an old version: cleared by recovery (above), tested.
- Nobody can hold the `debugger` permission today (Chrome drops it from `optional_permissions` at install), so there
  is no grant to revoke.

### Docs (no `site/` change in this PR)
- `docs/ARCHITECTURE.md` §10 (drop `optional_permissions: ["debugger"]`), §5.1 dark capture (no media offer; a page that
  only follows the OS setting keeps the derived variant), §8 `scan.run` opts (no `emulate`).
- `docs/IMPLEMENTATION.md` 5.2/5.3 rows and the risk row (say debugger was removed in SPC-44, date).
- `README.md` (lines 137-138, the permissions table row 199), `PRIVACY.md` line 33, `CHANGELOG.md` (an Unreleased
  "Removed" entry; the 1.0.0 line stays as history), `store/privacy-practices.md` (drop the debugger justification),
  `store/SUBMIT.md` line 17.
- **`site/privacy/index.html` line 88** also says "debugger". Editing it costs a Netlify deploy (15/300), so I propose
  **not** touching `site/` here and leaving a note for the orchestrator to batch it with SPC-23. PE/orchestrator call.
- `docs/TESTING.md`: rewrite T5.03 and T5.11, extend T0.03, add T5.13 (free in every open branch).

### Tests (same PR)
Unit (`apps/extension/test/mobileCapture.test.tsx`, rig loses `debuggerGranted`/`attachThrows`/`noDebuggerApi`; the rig
installs **no** `chrome.debugger`, and every test asserts `permissions.request` was never called):
- T5.03 popup at 390 → variant with `viewportWidth` 390; popup kept at 500/1280 → `MobileTooWideError(width)`, nothing
  returned; exactly 480 accepted, 481 rejected; a failing scan still closes the popup. Each of these asserts a single
  outcome (no branch).
- T5.11 full screen (manual or automatic) → `skipped`/`fullscreen`, no window, no tab, nothing sampled in the user's tab;
  existing tabbed/own-window/other-window/stray-tab cases kept unchanged; recovery closes a leftover popup and removes a
  legacy `mobile.emulatingTab` key without calling any debugger API; each remaining skip reason has its note.
- Scan card: `wide` shows "not captured (Chrome kept the window too wide)" and **no** button named "Capture with
  permission"; full screen shows "Try again" (never "Capture in this tab"), and clicking it re-runs the popup path.
- **T5.13 (new, U)** `runThemeCapture`: class switch present → `measured` and the variant is attached; class switch
  present but the page didn't change → falls through to `system`/`none`; only `prefersScheme` → `system`, no capture
  button, `permissions.request` never called; neither → `none`. `scanRun` with a stray `emulate` opt samples normally
  and never touches `chrome.debugger` (legacy caller).
- **T0.03** manifest: `optional_permissions` is absent (or has no `debugger`) and `permissions` has no `debugger`.
  Also a new e2e-build manifest check: the built `.output-e2e` manifest has no `debugger` either (it's built by
  `pnpm e2e`; the check lives in the e2e suite so the unit run doesn't need a second build).

E2E (`e2e/phase5.spec.ts`, the debugger is no longer pre-granted):
- **T5.03 unconditional.** The test first measures the host with an independent oracle: from the panel page it opens
  its own `chrome.windows.create({type:'popup', width:390, height:844})` on the fixture, reads the tab's real
  `innerWidth` via `chrome.scripting`, and closes it. Then it scans and asserts **exactly one** outcome, chosen by
  the oracle and not by what the code under test did: oracle ≤ 480 → `variants.mobile` is stored with
  `viewportWidth` == oracle (±2) and a blueprint; oracle > 480 → no variant, "not captured (Chrome kept the window too
  wide)", and no "Capture with permission" button. Under `CI` (Linux/xvfb, which honours narrow popups) it also asserts
  oracle ≤ 480, so CI always drives the capture path and can't pass on the "too wide" branch.
- T5.04 (class switch) unchanged; it must still pass with no debugger.

### Failure modes
- **Partial failure / cleanup:** the popup path is unchanged: `finally` closes only what we created and forgets the
  recovery record; tests keep the failing-scan-closes-popup cases.
- **Drift between two copies of a fact:** the permission list lives in `wxt.config.ts`, ARCH §10, README table,
  PRIVACY.md, store justification, release.yml and T0.03. All updated in this PR; T0.03 + the release check pin it.
  `site/privacy` is the one copy left behind (above), called out in the PR body.
- **Old callers / stale state:** `scan.run` ignores an unknown `emulate`; recovery clears the legacy session key;
  stored scans load unchanged (no schema change).
- **Misleading success:** no control remains that always fails; the `system` row says "not measured" rather than
  "not found", so a site with an OS-only dark mode isn't reported as having none.
- **Concurrency:** removing the tab-emulation lock is safe because nothing samples the user's tab under an override
  any more; the "no second capture while one runs" guard in `runMobileCapture` stays and stays tested.
- **Stacking:** #39 (scanFlow/captureFlow) may get more review folds; I rebase on `exec/spc-28` before the PR. SPC-21
  (#40) overlaps only in TESTING.md rows; I don't touch `test/helpers/chrome.ts` or `council.test.tsx`.

### Check
`pnpm gate` green, plus `pnpm build` and a grep that no file under `apps/` or `docs/` (outside `docs/sprint/`
history) still says `debugger`, except the CHANGELOG 1.0.0 line and the "removed in SPC-44" notes.

## PE ruling (pe-b2, 2026-10-17): APPROVED
- Drop the two `tabEmulationIdle` lines in `scanFlow.ts` (stacked on #39, they merge together). Keep the `tabEmulation.ts` name.
- Leave `site/` out; pe-b2 asks specimen-75 to batch `site/privacy/index.html` line 88 with SPC-23. The PR body names it.
- The legacy-caller test goes through the real background `onMessage` listener. The CI oracle assert has an explicit
  message. The grep check covers `e2e/` and `test/`. The PR body tells the release note to drop the debugger
  justification in the CWS dashboard on the next upload.

## Done
- Code exactly as in the table, plus one change beyond the plan: `MobileSkipReason` also loses `navigated`. Only the
  in-tab emulation threw it (the popup loads the URL fresh), so it was dead. Reasons left: `fullscreen`, `tabbed`.
- `scanRun` builds the sampler's options from a fixed pick (`theme`, `colorsOnly`, `skipComponents`), so a stray
  `emulate` is dropped there; there is no schema on `scan.run` to reject it.
- Tests: `test/mobileCapture.test.tsx` rewritten (26 tests). Its rig serves no `chrome.debugger` and logs every read of
  it. New `test/themeCapture.test.tsx` (T5.13, 7 tests: four `runThemeCapture` outcomes, the `system` card row, and a
  stray `emulate` sent through the real `background.ts` listener). T0.03 checks both builds. The e2e T5.03 uses an
  independent popup-width oracle and asserts exactly one outcome; under `CI` the oracle must be ≤ 480.
- Docs: ARCHITECTURE §5.1/§8/§10, IMPLEMENTATION 5.2/5.3/6.2/risk row, TESTING T0.03/T5.03/T5.11/T5.13, README,
  PRIVACY, CHANGELOG (Unreleased → Removed), store/privacy-practices.md, store/SUBMIT.md, release.yml manifest check.
- Grep: the only `debugger`/`emulat` left outside `docs/sprint/` and `site/` are the "no debugger" asserts, the
  "removed in SPC-44" notes, the CHANGELOG 1.0.0 history line and the legacy `mobile.emulatingTab` key.
- `pnpm gate` green locally on 2026-10-17 (313 extension unit tests, 55 e2e). gitleaks isn't installed locally,
  so `secrets` was skipped; CI runs it.

## Left behind (on purpose)
- `site/privacy/index.html` line 88 still says "Revoke site access, `debugger` or provider access". It needs a Netlify
  deploy, so it's batched with SPC-23 (orchestrator).
- CWS dashboard: the `debugger` justification should be removed on the next upload (owner).

## Reviews
- Lens A r1 (pe-b2): APPROVED, 0 C/H/M. The optional L1 is folded: the e2e T5.03 now allows ±2px between the oracle
  and the capture, and reads the card's px from the text. No re-review needed.

- Lens B r1 (spc-44-93): approve once CI is green. 0 C/H, 1 M, 3 L.
  - M1 (CI must show xvfb keeps a 390px popup ≤ 480): waiting on the `gate` check on #43. If it fails on the oracle
    assert, keep the assert and fix the launch (window size / device scale factor), or ask the PE. Never relax it.
  - L1 folded (specimen-75 asked for all LOWs): the `wide` row adds "Turn off Also capture mobile to skip this window
    on later scans." (tested). Skipping the popup for the session after `wide` is left as a possible follow-up.
  - M1 evidence: T5.03 now logs `T5.03 oracle: a 390px popup is NNNpx wide on this host` and adds an annotation.
  - M1 hit on CI run 39044525249: the oracle read **1280px**. The cause wasn't xvfb: Playwright's persistent context
    forces a 1280x720 viewport on every page, popups included (locally too, headed or not). Before SPC-44 the
    debugger's device-metrics override hid this. Fix: a `realWindows` fixture option (`viewport: null`) used only
    by T5.03. Locally the oracle now reads 390 and the capture branch runs. The CI assert is unchanged.
  - L2 folded: TESTING.md T5.03 says a local green doesn't verify mobile capture; only CI is pinned.
  - L3 folded: `store/listing.md` says dark/light capture is "on sites with a theme switch".

## Next
Confirm the CI `gate` on #43 is green (M1), then tell the lens-B reviewer.

## How to resume
Read this file, `git log exec/spc-44`, and any `docs/sprint/reviews/SPC-44-*.md`. Worktree `worktrees/spc-44`.
