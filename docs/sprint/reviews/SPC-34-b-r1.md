# SPC-34 lens B review, round 1

Reviewer: fresh lens B + contract · PR #36 · head d63b397 · 2026-10-17
Scope: `gh pr diff 36`, plus the code it touches (`collect.ts`, `sanitize.ts` stream sanitizer, `councilHost.ts`,
`Council.tsx`, `vibe.ts`, `polishPrompt.ts`, `Byok.tsx`). `pnpm -F @specimen/ai test`: 183/183 green.

**Count: 0 CRITICAL · 0 HIGH · 1 MEDIUM · 4 LOW.**

## Contract check (matches)
- `done.truncated?: true` is optional and additive; a `done` without it still returns normally (webllm.test).
- The host sends `truncated` only on `finish === 'length'` and not stopped. Precedence is stopped (`aborted`) >
  `'abort'` (`other`, "cut short") > `'length'` > `done`. The #31/#34 stop/abort/crash paths are untouched.
- The client throws `ProviderError('other', TRUNCATED_TEXT)` only after every delta. `LLMProvider` and
  `ProviderErrorKind` are unchanged, and `CRITIQUE_ERRORS` is not touched.
- Council: an exact-constant match goes to `fail(CRITIQUE_TRUNCATED)` with no retry (call counts tested). On a
  middle turn the run stops with no later calls. On the summary, `summaryText` and `verdict` stay empty because they
  are read only from a `done` summary. The Stop and stall checks run before the thrown-error check, so a Stop that
  races the cut still ends as `stopped`.
- Persistence: a truncated run is stored like any other `error` run (`councilHost` saves on each ended turn and at
  the end). A reopened panel shows `rec.error`, and `Report` renders only for `done`. I found no path that turns a
  cut-off local reply into a complete one: council, vibe, polish and Ask all receive the throw.
- Ask: the message keeps `error`, so the `!m.error && m.content` filter keeps it out of history, both live and after
  `saveChat`/`loadChat` (tested).

## MEDIUM

### M1. The council hides the partial text that the handoff says stays visible, and this differs from Ask
`Council.tsx` `TurnBody`: `if (t.status === 'error') return <span …>{t.error}</span>;`. The cut-off turn's
`content` (`safe(raw)`) is stored but never rendered. The handoff ("Partial turn text stays visible (already the
behaviour on errors)") and the PR's side-effect note describe something the code does not do.
**Scenario:** a 3×2 local Gemma run takes about 6–7 minutes, and the summary is cut off at its cap. The user sees
only "A reply hit the length limit…", and the summary text they waited for is gone, though it is in storage. Ask, in
the same situation, shows the partial text above the error, so the two views behave differently for one condition.
**Fix:** pick one of these:
- (a) Render `t.content` (when non-empty) above the error in `TurnBody`, the way Ask does. This is still no verdict:
  `Report` and `parseVerdict` remain gated on `done`, so the contract holds. Add a Council component test asserting
  the cut-off text and `CRITIQUE_TRUNCATED` both render and no `Report` appears.
- (b) Keep the UI as it is and correct the handoff and PR text ("stored, not shown").

I recommend (a) because it matches Ask and keeps the user's minutes of local compute visible.

## LOW

### L1. Ask keeps the last streaming snapshot, not `safe(raw)`: it can lag, and a word cut at the limit is never matched
`collect` throws before `return safe(raw, scan)`, so the bubble keeps the last `onText` snapshot. Two effects:
- `createStreamSanitizer` redoes an open line over 512 chars only every 256 chars, so up to about 255 generated chars
  can be missing from the shown text. The text shown is shorter than what was generated, but it is still sanitized.
- The text now ends wherever the cut fell, and that cut-off end is persisted. Before this PR it was hidden on error.
  A brand cut mid-word ("…like Strip") or a partial headline isn't matched by the whole-word or whole-headline
  patterns. The leak is weak, the same as council `safe(raw)` on errors and as the transient live stream, but it is
  now stored and replayed.

**Fix:** in `collect`, wrap the loop in a try/catch that calls `onText?.(safe(raw, scan))` before rethrowing; this
fixes the lag. Optionally, on error trim the text after its last whitespace before display. Test: a truncating
provider with an open line over 600 chars shows the whole sanitized line.

### L2. "Try again, or use fewer reviewers or rounds" is untested against how local Gemma actually truncates
With `contextTokens: 4096`, a turn's cap is `min(1200|1500, 1024)`. A persona asked for "under 120 words" reaches
1024 only through a repetition loop, or through WebLLM stopping at the context window when prompt plus output
reaches 4096. `messageBudget` assumes 3 chars per token, which dense hex/px JSON can beat. If the second cause
dominates for the summary (the largest prompt), the cut-off is systematic: every run on a dense page fails at its
last turn, and "Try again" won't help.
**Fix:** none needed to merge. Before the CWS release, do one manual run of local Gemma on a dense fixture and note
the result in the handoff. If summary truncation turns out to be systematic, open a follow-up to tighten the summary
budget (a lower chars-per-token ratio for local models).

### L3. Ask's Stop still replays a partial answer as a whole one (existing behaviour, now a visible gap)
On `kind === 'aborted'`, no `error` is set, so a stopped partial answer looks whole and goes into the next question's
history. A cut-off answer is now labelled and excluded, but a stopped one is not. This is not a regression and is out
of the contract's scope.
**Fix:** a follow-up ticket: mark stopped bubbles (e.g. `error: 'Stopped'` or a `stopped` flag) so the history filter
excludes them.

### L4. Vibe fails when Gemma has finished its JSON but keeps writing until it reaches 300 tokens
`llmHost` doesn't pass `response_format`; `json: true` is only a prompt suffix. If Gemma closes a valid object and
then rambles or repeats until it reaches `maxTokens: 300`, vibe used to parse the object. It now raises
`TRUNCATED_TEXT`. This follows the contract and is probably rare.
**Fix:** none required. If it shows up in practice, vibe could catch `TRUNCATED_TEXT` and fall back to the text-only
retry, or the host could pass `response_format: {type:'json_object'}` for `json` requests. Either belongs in a
separate ticket.

## Checked, no finding
- A stall timer racing the final `done{truncated}` gives `stalled`, which is checked first: the turn fails with
  `STALLED_ERROR` and still has no verdict.
- A truncated persona turn is never fed to later turns, because the run stops.
- `renderTurnMessage` reads only `done` turns.
- Byok "Test" uses BYOK adapters only, so it is unaffected. `polishPrompt` falls back with `reason === TRUNCATED_TEXT`.
- Old stored Ask messages with content and an error now show their content. That text was a sanitized snapshot from
  the start (`23abe5d`), so no unsanitized text appears.
