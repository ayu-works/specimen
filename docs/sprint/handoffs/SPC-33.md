# SPC-33 handoff: a vibe looks saved but isn't

Executor session `spc-33-4f` · branch `exec/spc-33` · lane A · PE `pe-8a` · orchestrator `specimen-6a`.

## Plan (APPROVED by pe-8a 2026-10-17; build notes on the Linear comment)

**Problem.** (1) `packages/ai/src/features/vibe.ts` returns the parsed summary uncapped and keywords uncapped in
length (count is already `.slice(0, 8)`), so a looping model (or one ignoring `maxTokens: 300`) yields a vibe over
the v5 bounds from #33 (`BOUNDS.vibeSummary` 4000, `BOUNDS.keywords` 50, `BOUNDS.keyword` 100). (2) #33's
`updateScan` then rejects (`DesignScanSchema.parse` of the merged row), and `Vibe.tsx` drops it with
`.catch(() => {})`: the panel shows the vibe, the Library row doesn't have it.

**Base.** `BOUNDS`, `cutText` and `libraryErrorText` exist only on #33 (`exec/spc-19`, open). To start before it
merges I build on top of `origin/exec/spc-19` (rebased locally onto current `origin/main` if it isn't yet, so #32's
fail-closed vibe code is what I edit), and rebase onto `main` once #33 merges; the PR opens only after that rebase
(so its diff is just SPC-33). If the PE prefers, I wait for #33 instead.

**Approach.**
1. `vibe.ts` (producer clamps, after the brand filter, so the bound holds on the final text):
   - `summary = cutText(safe(result.summary, scan).trim(), BOUNDS.vibeSummary).trim()`; still throws
     `VIBE_FILTERED` when empty (keeps #32's fail-closed behaviour; the sanitizer runs before the cut, so a cut can
     only remove text, never expose a brand).
   - Also cut the raw summary to a generous pre-sanitize cap (`BOUNDS.vibeSummary * 2`) before `safe()`, so a
     megabyte reply doesn't go through the sanitizer whole (the SPC-32 freeze class). Cutting before sanitizing
     could split a brand at the cut point, and the sanitizer can shrink text (so "the post-cut drops it" isn't
     guaranteed): when the pre-cap applied, the sanitized text also drops its trailing partial word (cut back to the
     last whitespace) before the final cut, so a split brand fragment never survives. Tested with a brand straddling
     the pre-cap in a mostly-brand reply.
   - keywords: each `cutText(safe(k, scan).trim(), BOUNDS.keyword).trim()`, filtered, `.slice(0, min(8, BOUNDS.keywords))`.
     Same pre-sanitize cap (`BOUNDS.keyword * 2`) per keyword, and keyword count capped before mapping so 10 000
     keywords aren't each sanitized.
   - `model: provider.id` stays (provider ids are short constants); no clamp.
   - No hard-coded numbers; all from `BOUNDS`.
2. `Vibe.tsx`: await the save instead of `void … .catch(() => {})`, in its own try after `setVibe`, so a save failure
   never looks like a vibe failure. On reject: `setSaveErr("Vibe not saved to Library: " + libraryErrorText(e))`,
   shown as `text-destructive` with `role="alert"`, while the vibe stays shown (it's still usable for the prompt in
   this session). Wording matches #33's "Not saved to Library". `updateScan` on a scan that isn't in the Library
   resolves (no row → no-op), so unsaved scans show no error, as today.
   - Stale results: a run counter (`useRef`) plus the scan id: a save result from an older run, or for a scan that
     is no longer the current one, is ignored (no error shown on the wrong scan). A new run clears the old error.
   - `busy` stays true until the save settles (it's one IndexedDB write), so a second click can't interleave.

**Files.** `packages/ai/src/features/vibe.ts`, `packages/ai/src/features/vibe.test.ts`,
`apps/extension/src/entrypoints/sidepanel/views/Inspect/Vibe.tsx`, new `apps/extension/test/vibe.test.tsx`,
`docs/TESTING.md` (new IDs, PE's call), this handoff.

**Tests (IDs: PE's call; I propose new rows rather than overloading T3.x/T4.x).**
- `T3.35 U` vibe clamps to `BOUNDS` (`vibe.test.ts`, mock provider, no real LLM):
  - looping model: JSON summary of 50 000 chars and 10 000 keywords of 500 chars each → summary ≤ `BOUNDS.vibeSummary`,
    ≤ 8 keywords each ≤ `BOUNDS.keyword`, and the result passes `DesignScanSchema.shape.vibe` (i.e. `updateScan`
    would accept it); asserts against `BOUNDS`, not literals.
  - looping model with no JSON (fallback path) still ≤ bound.
  - a cut never splits a surrogate pair (emoji at the boundary).
  - a brand near the cut point and a brand in a keyword are still removed; an all-brand summary still throws
    `VIBE_FILTERED` (#32 behaviour kept).
  - normal short output unchanged (existing tests stay green).
- `T3.36 C` Vibe card save failure (`apps/extension/test/vibe.test.tsx`, jsdom, mock provider, `updateScan` mocked):
  - `updateScan` rejects with a `QuotaExceededError` → vibe text still shown **and** "Vibe not saved to Library: your
    browser is out of storage space" visible (role alert); the generic vibe error line is not shown.
  - `updateScan` resolves → no "not saved" text.
  - a rejection arriving after the scan changed (or after a second run started) shows no error.
  - (integration) real `updateScan` on fake-indexeddb with a stored scan + an over-bound vibe would reject; with the
    producer clamp the same looping model's vibe saves and reads back from the Library.

**Failure modes.**
- *Misleading success* (the bug): fixed by surfacing the reject; tested.
- *Partial failure*: vibe shown, save failed → explicit message; store keeps the vibe so the prompt still uses it;
  re-running Describe retries the save.
- *Concurrency / stale result*: run counter + scan-id guard; busy held through the save; tested.
- *Drift between two copies of a fact*: bounds read from `BOUNDS` (one table shared with the schema); the test
  validates against the schema itself, so a future bound change can't drift silently.
- *Sanitizer cost on huge replies*: pre-sanitize cap; bounded work.
- *Brand leak via cutting*: sanitize first, cut after; after a pre-cap the trailing partial word is dropped.
- *Atomicity / idempotency*: `updateScan` is one transaction (#33); clamping is pure and idempotent.
- *Errors during cleanup*: none (no cleanup path); `finally` only resets `busy`.

**Out of scope.** Other `updateScan` callers (#33 covered card edits/ScanCard). No schema change.

## Done
- Read brief/setup/plan, SPC-33 + overrides; `pnpm i`; plan approved (stack on #33, IDs T3.35/T3.36).
- `vibe.ts`: `clamp()` = bounded 2×max pre-slice → `safe()` → drop trailing partial word if pre-sliced → `cutText` to
  `BOUNDS`. Keywords: first 32 raw → clamp → drop empties → first 8 (≤ `BOUNDS.keywords`). No hard-coded bounds.
  Note: an over-long one-word keyword is dropped (same rule as the summary), tested.
- `Vibe.tsx`: awaits `updateScan`; failure → `role="alert"` "Vibe not saved to Library: <libraryErrorText>", tied to
  the scan id; run counter + current-scan check drop stale results (a vibe for an old scan is no longer written onto
  the new one either). Scan id passed through uncut (PE note 4).
- Tests: T3.35 ×8 in `packages/ai/src/features/vibe.test.ts`; T3.36 ×4 in `apps/extension/test/vibe.test.tsx`.
- Shown to bite: old `vibe.ts` → 4 T3.35 fail and the T3.36 integration save test fails (real `updateScan` rejects);
  no partial-word drop → the brand-fragment, one-long-word and one-word-keyword tests fail; old `Vibe.tsx` → the
  "not saved" test fails; no stale guard → the moved-scan test fails.
- Rebased on `origin/main` de35272 (#33, #34), temp base dropped. `pnpm gate` green (1 pre-existing lint warning in
  chatScrub, not this PR); check-ids --all passes.

## Lens B r1 fold (spc-33-06: 0C/1H/2M/4L; orchestrator: fold H1, M1, M2 + cheap LOWs; lens A L1 un-accepted)
- H1: `clamp()` sanitizes the text again after the final cut (sanitize only removes, so it stays ≤ max). Reviewer's
  summary + keyword repros added to T3.35; both fail on r1.
- M1 (+ lens A L1): save failures are also `toast()`ed (the global Toaster outlives Inspect). Run state is module
  level (`latestRun`, `running`), so a remounted card shows "Looking…" and can't start a second run; saves go through
  a module-level queue so an older save never lands after a newer one.
- M2: a vibe finished after a scan switch is still saved by id (not shown; failure → toast only).
- L1 non-string keywords dropped in `VibeSchema`; L2 fallback uses `cutText(…, 280)`; L3 keywords deduped
  case-insensitively; L4 busy covers the model call only (a save that never settles no longer pins the button;
  trade-off: later saves queue behind it — a hung Dexie open blocks every write anyway).
- New/changed T3.36 tests (6) fail on r1 `Vibe.tsx`; 5 new T3.35 tests fail on r1 `vibe.ts`.

## Next
- Lens A r1 (pe-8a): APPROVED; its L1 is folded with lens B M1 (toast, no store.ts change).
- Lens A fold check of fbf91de: APPROVED (pe-8a); no lens B re-review (orchestrator). Optional LOW (a vibe() call
  that never settles keeps the card busy) predates this PR: orchestrator files it, not folded.
- #35 went to the owner at fbf91de. Local-only commits after it (review note, this handoff) are NOT pushed, per the
  orchestrator. Stand by for the owner's decision.

## How to resume
- Worktree as above; read this file and the PR's reviews under `docs/sprint/reviews/SPC-33-*`.
