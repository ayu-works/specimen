# SPC-40 lens B review, round 1 (PR #44)

Reviewer: fresh lens B, 2026-10-17. Scope: `Vibe.tsx` timeout/abort, T3.38 tests, the TESTING.md row.
Count: **0 CRITICAL · 0 HIGH · 2 MEDIUM · 3 LOW.**

## What holds (checked, no finding)
- **A late reply after the timeout:** `run()` only reads the raced result, so a late resolve never reaches `setVibe`, the
  note or `updateScan`. A late rejection (e.g. `ProviderError('aborted')` from a provider that honours the signal) is
  absorbed by `Promise.race`, so there is no unhandled rejection. Test 2 covers this with a real stuck generator.
- **A reply exactly at the timeout:** the race settles with whichever promise settles first. Between the race settling and
  the `finally` that clears the timer there are only microtasks, so the timer can't fire in that window. Whichever side
  wins, the other has no effect: a late `abort()` on a finished call does nothing, and a late reply is dropped.
- **Unmount or panel close mid-call:** `setBusy` and `setErr` on an unmounted card are no-ops in React 19, with no
  warning. The timer is module-scoped on purpose, so the run still ends and `running` is cleared. Closing the panel kills
  the document, so no timer outlives it, nothing is persisted, and for Gemma the Port disconnect stops the offscreen job.
- **Two runs back to back:** `running` blocks a second run while one is in flight. After a timeout the stuck call is
  never read, and `latestRun` and `shown()` still guard what is displayed. For WebLLM, the abort marks the queued or
  running job `stopped` (`llmHost.ts` `stop()`), so the retry doesn't wait behind a dead generation.
- **#35 save path is kept:** the `saves` chain, `libraryErrorText`, the toast and `saveErr` are untouched and only run
  after an in-time reply.
- **The tests really drive the never-settling path.** `hangingProvider` awaits a gate that never opens and ignores its
  signal. That is exactly the ticket's case, and all four tests would fail on the old code.

## MEDIUM

### M1. The 120 s budget includes time spent queued behind another local-model chat, so a busy Gemma reads as "too long"
`llmHost.ts` serialises every WebLLM chat on one `chatChain`, and that includes council turns
(`councilHost.ts` builds a `createWebLLMProvider` in the same document). The vibe timer starts when the user clicks, not
when generation starts.
**Scenario:** the owner starts a council run with Local Gemma (several personas and rounds, minutes in total) and then
clicks "Describe the vibe". The vibe chat waits in `chatChain`, and after 120 s the card says *"The model took too long
to describe the vibe. Try again."* Retrying does the same until the council finishes. The message blames the model's
speed when the real cause is that the model is busy, and "Try again" sends the user into a loop that can't succeed yet.
The cold-load case the PE noted (a vibe during a download) gets the same misleading text.
**Fix (pick one):** (a) word the message honestly for every cause, for example *"No answer from the model after 2
minutes (it may be busy or still loading). Try again in a moment."*; or (b) before `run()`, check
`provider.status()`, and if it reports `downloading`, say so instead of starting the timer. (a) is the minimum. A
manual step in the PR for "vibe during a Gemma council run" would cover the rest.

### M2. A total cap is not the council's stall timer, so a slow but valid Gemma reply can be killed mid-stream
The handoff justifies 120 s as "the council's first-text stall" (`DEFAULT_STALL_MS.first`). But the council's timer is
reset on every delta (`arm(stall.gap)`, 30 s between pieces of text) and has no total cap. Here 120 s is a hard cap on
the whole `vibe()` call. For local Gemma that means status → `client.load` from cached weights ("Loads on first use":
shader compile plus a GPU upload) → prefill of up to the 4096-token page-data budget → up to 300 output tokens.
**Scenario:** an integrated-GPU laptop, first vibe after the panel opens. Loading from cache takes about 40 s, prefill of
a ~3k-token prompt about 30 s, and generation at about 4 tok/s for ~250 tokens about 60 s, so ~130 s in total. Text has
been streaming for a minute when the card aborts it and shows "took too long". Because the model stays loaded, the retry
may succeed, but only by luck of timing. The same machine never trips the council's stall.
**Fix:** match the council inside `Vibe.tsx` without touching `vibe()`. Hand `vibe()` a thin provider wrapper whose
`chat` re-arms the timer on each yielded delta:
`{ ...provider, async *chat(req, s) { for await (const d of provider.chat(req, s)) { arm(VIBE_GAP_MS); yield d; } } }`.
Arm `VIBE_TIMEOUT_MS` (first text) up front and `DEFAULT_STALL_MS.gap` after each delta. A provider that never yields
still times out at 120 s, which is the ticket's case. Add a test where deltas arrive every 20 s for 200 s in total and
the vibe is shown. If that is out of scope, at least correct the handoff and the TESTING.md row so they don't claim
parity with the council, and file a follow-up.

## LOW

### L1. A timeout after a tab switch is only reported by a 1.5 s toast
`Toaster` clears after 1500 ms. The rationale ("the card may have unmounted… the toast outlives it") covers exactly the
case where the user is on another tab for up to 2 minutes, so they will very likely miss it. When they come back to
Inspect, the remounted card is idle with no error, and the vibe silently didn't happen.
**Fix:** keep the last run's error in module state as `{ scanId, text }`, like `saveErr` but module-level, and have a
remounted card show it when `scan.id` matches. Clear it on the next run.

### L2. When the card is visible, the timeout is reported twice (inline line + toast)
`if (e === timeout) toast(text)` runs even when `shown()` is true, so a user watching the card gets the same sentence in
two places at once. This is harmless but noisy, and it doesn't match the other vibe errors, which are inline only.
**Fix:** track mounted state (a `mounted` ref set in the existing effect) and toast only when the card is unmounted or
`!shown()`. If L1 is done, the toast can stay as a supplement, but then skip it when the line is visible.

### L3. Test gaps and a timing margin
- No test for a provider that **honours** the signal. That path depends on `reject(timeout)` running before
  `ctl.abort()`, and reordering those two lines would show "Stopped" instead of the timeout text. Add a provider whose
  `chat` throws `ProviderError('aborted', 'Stopped')` on abort, and assert that the card shows `VIBE_TIMEOUT_TEXT`.
- Test 1 asserts the card is still busy at `VIBE_TIMEOUT_MS - 1000` with `shouldAdvanceTime: true`, which also moves the
  fake clock with real time. If render, Dexie and `findByRole` take more than about 1 s of real time on a slow CI runner,
  the timeout fires before that check and the test flakes. Use a wider margin (e.g. advance `VIBE_TIMEOUT_MS / 2`) or
  `shouldAdvanceTime: false` for the timeout tests, if Dexie allows it (only `setTimeout` is faked).
