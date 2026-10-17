# SPC-44 review: lens B + security/privacy, round 1

Reviewer: fresh lens-B reviewer · PR #43 (`exec/spc-44` @ 3fc5685, base `exec/spc-28`) · 2026-10-17

**Verdict: APPROVE once CI is green.** 0 CRITICAL, 0 HIGH, 1 MEDIUM (it depends on CI), 3 LOW.

## What I checked (all OK)
- **Built manifest.** `apps/extension/.output/chrome-mv3/manifest.json` was built after the commit (20:47, commit at
  20:45). It has `permissions` = activeTab, scripting, sidePanel, storage, offscreen, unlimitedStorage, plus
  `optional_host_permissions: ["<all_urls>"]`, and no `optional_permissions`, no `host_permissions` and no
  `content_scripts`. `debugger` appears nowhere in the manifest or in any built file under `.output/chrome-mv3`. The
  e2e manifest has no `debugger` either. No new permission was added. T0.03 pins both builds, and `release.yml` now
  checks both lists.
- **No dead UI is left.** `git grep` finds no `requestDebugger`, `runMediaCapture`, `withPermission`, "Capture with
  permission", "Capture in this tab", `offer`, `attach` (as a skip reason) or `navigated` anywhere in `src/`. The
  `wide` state is text only. `skipped` always shows "Try again", which runs the popup path. The `system` theme row is
  text only. No control remains that asks for a permission.
- **Old stored data.** `DesignScan` and `variants.*` are unchanged, so no migration is needed. The panel memo
  (`restore.ts` `PanelMemo`) stores only scanId, origin, activeTab and askMode, not `Extras`, so a stale
  `theme: 'offer'` or `mobileSkip: 'attach'` can't be restored. The only setting is `settings.captureMobile`, which is
  unchanged. `chrome.storage.session` is cleared when the extension updates, and the legacy `mobile.emulatingTab` key
  is removed by recovery anyway (tested).
- **Old `emulate` callers.** `scanRun` hands the sampler a fixed pick (`theme`, `colorsOnly`, `skipComponents`), so a
  stray `emulate` is dropped and never throws. This is tested through the real `background.ts` listener (T5.13). Only
  extension contexts can send `scan.run` (there is no `externally_connectable`), and after an update no old panel can
  survive.
- **Fallbacks are tested.** The popup path has single-outcome unit tests (390 accepted, 480/481 boundary, wide → one
  sample then `MobileTooWideError`, the popup is closed when the scan fails). Full screen → `skipped` without touching
  the user's tab. The class-switch path is covered by T5.13 (unit) and T5.04 (e2e). The rigs record every read of
  `chrome.debugger` and every call to `permissions.request` and assert that there are none.
- **Docs.** README, PRIVACY, store/privacy-practices.md, store/SUBMIT.md, ARCH §5.1/§8/§10, IMPLEMENTATION and the
  CHANGELOG are updated. What's left is the CHANGELOG 1.0.0 history line (correct as history) and
  `site/privacy/index.html:88`, which is deferred to SPC-23 on purpose.
- **Security.** No new message handler and no new storage. API keys and page data are not touched. The change only
  removes attack surface (CDP attach).

## MEDIUM

### M1. "Linux/xvfb keeps narrow popups" is unproven until this PR's CI run finishes
`e2e/phase5.spec.ts` T5.03 requires `oracle ≤ 480` under `CI`. Before this PR, the e2e build pre-granted `debugger`,
so CI could reach a phone width through emulation even when xvfb kept the popup wide. No CI run so far has shown that
a plain 390px popup stays ≤ 480 there. The `gate` check on #43 is still **pending**.
- **Failure scenario:** xvfb's window manager keeps the popup at its minimum (≥ 500px). The CI gate goes red on
  "host kept the popup wide", or someone "fixes" that by dropping the CI assert, and T5.03 then passes on the
  too-wide branch again.
- **Fix:** don't approve until the `gate` check on #43 is green. If it fails on this assert, keep the assert and look
  at the window size (for example, set `--window-size` and `--force-device-scale-factor=1` on the CI launch), or ask
  the PE for a ruling. Don't relax the assert.

## LOW

### L1. Where Chrome always keeps popups wide, every scan opens a popup that can't produce anything
Mobile capture is on by default. On a host that keeps popups ≥ 500px, each scan flashes a small window, samples it
and throws it away, and the card says "not captured (Chrome kept the window too wide)". The user isn't offered
anything else to do (by design under option B), but they pay for a popup and a full sample on every scan.
- **Fix (optional, follow-up):** add one sentence to the `wide` row's note ("Turn off Also capture mobile to skip
  this"), or remember `wide` for the session and skip the popup next time. A follow-up ticket is enough. Don't
  block on it.

### L2. The local e2e T5.03 still runs either branch (only CI is pinned)
Outside `CI`, the oracle picks the branch, so on a developer's Mac the test can stay on the "too wide" branch for
good. This is fine because CI pins it (M1), but the handoff and TESTING.md row should say so plainly, so nobody reads
a local green as "mobile capture verified".
- **Fix:** add one clause to TESTING.md T5.03: "outside CI the oracle may select the too-wide branch; CI must take
  the capture branch."

### L3. The store listing doesn't say dark/light capture needs a theme switch
`store/listing.md:31` says "Capture the mobile layout and the dark or light theme". This is still true, but only on
sites with their own theme switch. Sites that follow the OS setting now get a derived variant. The README already
explains this (line 138).
- **Fix (optional):** "…and the dark or light theme (on sites with a theme switch)…". Do it in this PR, or batch it
  with the next CWS upload, which already has to drop the `debugger` justification.
