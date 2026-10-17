# SPC-42 lens B r1: PR #53 (stopped Ask answer marked; history from whole pairs)

Reviewer: fresh lens B, 2026-10-17. Scope: `gh pr diff 53` on top of `exec/spc-41`. Read: setup.md, the SPC-42 handoff,
Linear SPC-42 (1 comment, the PR link), `Ask.tsx`, `askHistory.ts`, `collect.ts`, `ask.ts`, `webllm.ts`, `errors.ts`,
`sse.ts`, `App.tsx` tabs, the tests. Ran `vitest run test/ask.test.tsx test/askHistory.test.ts`: 8/8 green.

**Count: 0 CRITICAL, 0 HIGH, 2 MEDIUM, 2 LOW.**

What holds up:
- Stop mid-answer, Stop before the first token, and both abort shapes (`ProviderError('aborted')` from WebLLM and
  mapThrown, a bare `DOMException` from chromeBuiltin/sse) all get the marker, because the check is `ctl.signal.aborted`.
  A Stop that races a normal finish leaves the answer whole (`ask()` resolved first), which is right.
- A token-limit cut (`TRUNCATED_TEXT`) or an error mid-stream after a Stop is marked "Stopped." instead. Both are
  excluded from history either way, so there's no harm.
- History stays well-formed. `askHistory` emits only user/assistant pairs, so `MAX_HISTORY = 12` (even) slices on a
  pair boundary and the request always starts with `user` and alternates. Two user turns in a row can no longer occur.
- Reopening the panel (SPC-26): the marker lives in the existing `error` field, `chatScrub` only rewrites key-like text
  in it (it never matches "Stopped."), and the reload half of test 1 really goes through `loadChat`. On this branch
  Council does not write to `chats`, so there is no shared Ask/council history to break here.
- The tests use fake providers only, with no network. Both new Ask tests fail against the old `Ask.tsx`: the old code
  sets no marker, so the text and role assertions fail. `askHistory.test.ts` imports a new module.

---

## MEDIUM-1: switching tabs mid-answer brings back the bug this PR fixes (a partial answer replayed as whole)

`busy` is component state, but the stream runs on after Ask unmounts ("Streams keep running if the tab is switched").
Radix `TabsContent` unmounts tabs that aren't shown (no `forceMount` in `App.tsx`), and so does the Quick/Council
toggle (`AskPane`). When Ask mounts again, `busy` is `false`, Send is enabled, and Stop is hidden.

**Scenario** (local Gemma, a slow answer): ask Q1. While it streams, open Inspect, then come back to Ask. Stop is gone,
so the user can't stop Q1. They type Q2 and send it.
1. `askHistory` sees `[…, Q1, a1 = "The accent is" (still streaming, no error, non-empty)]` and replays a1 **as a whole
   answer**. This is the replay SPC-42 exists to prevent.
2. Q1's `onText` and `setLast` patch "the last message", which is now Q2's bubble, so the two streams overwrite each
   other in a2. a1 freezes at whatever partial text it had and never gets a marker.
3. Q1's `finally` sets the module-level `controller = null`, so Stop does nothing for Q2.
4. `saveChat` stores the frozen, unmarked a1. Every later question replays it, even after a reload.

The root cause predates this PR, but it gets around the PR's claim that a stopped answer is never replayed. The PR
body's owner step 1 would not catch it.

**Fix (small, in Ask.tsx):**
- Keep "in flight" outside the component, either a module-level `let inFlight: string | null` (scanId) next to
  `controller`, or a store field. Derive `busy` from it, so a remount shows Stop and blocks Send.
- Have `setLast` patch the index captured at submit (`const at = p.length + 1` inside the first `setChat`), not
  `p.length - 1`.
- Test: send, unmount and remount `<Ask/>` mid-stream, then assert that Stop is visible and Send is disabled. Also
  assert that pressing Stop marks the first answer.

If this is out of scope for SPC-42, open a follow-up ticket and add one line under "Limit" in the PR body.

## MEDIUM-2: "Stop, then redirect" loses the question the user is redirecting

A common pattern is to stop a long answer and steer the model: Stop, then "shorter, just the hex values" or "no, I meant
the buttons". The pair-only rule now drops **both** the stopped answer and its question. The model receives only
"shorter, just the hex values" with no idea what to shorten. Before this PR it at least got the question, either as a
user turn or with the partial answer. The same goes for "try again" after a rate-limit or network error: the question
is gone, so the retry has nothing to retry. The user still sees Q1 in the transcript and expects the model to see it
too.

**Fix:** keep alternation without passing the partial off as whole. For `error === STOPPED_TEXT` (and optionally any
error), replay the pair as the question plus a fixed assistant stub such as `"(The user stopped this answer before it
finished.)"` / `"(No answer: the request failed.)"`. This keeps the history well-formed (user/assistant), keeps the
context, and never replays the half text. Add a unit case in `askHistory.test.ts` and a component assertion that
`calls[1].messages` contains Q1 and the stub but not the partial text. If the owner prefers dropping the question,
write it down as a deliberate choice in the PR body ("after a Stop, a follow-up does not see the stopped question").

## LOW-1: an endless "…" still shows when an answer is empty without an error

The renderer shows the thinking mascot whenever `!m.error && !m.content`, whether or not a request is running. Two ways
to get there remain:
(a) `ask()` resolves to `''`: `safe()` fails closed when the sanitizer throws, or a provider sends an empty reply.
`setLast({content: ''})` sets no error, so the bubble bounces "…" forever, and again after every reload. (`askHistory`
does correctly drop it.)
(b) Transcripts saved before this fix that hold a Stop-before-first-token bubble (`content: ''`, no error). The PR's
"Limit" only mentions old *partial* answers. These old rows also show "…" forever.

**Fix:** show "thinking" only for the last message while a request is in flight. Otherwise, render an empty,
error-free assistant bubble as the muted "Stopped." / "No answer." line. Also, in `submit`, if `final === ''`, call
`setLast({ error: 'No answer came back. Try again.' })`. Test: a fake provider that yields nothing and returns shows
no thinking mascot.

## LOW-2: an abort the user didn't start now shows as a red "Stopped" with the sad mascot

`mapThrown` maps any `AbortError` to `ProviderError('aborted', 'Stopped')`. If one surfaces without the user pressing
Stop (for example, the browser tears down a Chrome built-in AI session, or a future internal timeout), the bubble now
says "Stopped" (no full stop) in red. That reads like the muted "Stopped." line but looks like a failure, and the user
didn't stop anything. Before this PR the case was silent. The new behaviour is better but confusing.

**Fix:** in the `catch`, when the signal was not aborted and `kind === 'aborted'`, show `"The answer was interrupted.
Try again."`. One more case in the DOMException test would cover it: throw `AbortError` without aborting the signal.
