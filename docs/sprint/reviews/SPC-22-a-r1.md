# SPC-22 (PR #25), PE lens A, round 1

Reviewer: pe-1b · 2026-10-15 · head `7abaf1f`

**0 CRITICAL · 0 HIGH · 2 MEDIUM · 3 LOW.** Approve once the two MEDIUMs are fixed. CI `gate` and `video` are green
on `7abaf1f`.

## What holds (checked against the code)
- **The 7 plan conditions are all in the code and tested:**
  - quiet-abort → `stopped` (`critique.ts:430`, T3.20 with a hand-written provider);
  - one cancellable rate retry (`:411-423`, three T3.21 cases);
  - fixed per-kind error text with a fake-key test that can fail (`CRITIQUE_ERRORS`; T3.21 asserts the key is
    absent from the result and every snapshot);
  - a non-vacuous sanitizer test (T3.22 asserts `#1a2b3c`/`16px` survive, and `filtered` is a separate case);
  - the flag on only for `=== true` and off on a read error;
  - a scan change aborts the run;
  - contrast first and capped at 12.
- **Earlier turns are fed to later reviewers only as sanitized text.** Only `done` turns are rendered, so `filtered`,
  `stopped` and `error` turns never reach a prompt (`renderTurnMessage`).
- **The cap is enforced in the engine:** clamps, plus exactly one summary step. Human messages add no calls.
- **No schema change, no `site/` change, no permission or manifest change.** The flag only adds a storage key, and
  the Labs card renders only with `?labs=1`.
- **The `maxTokens` 1200/1500 deviation from the plan is recorded in the handoff** (reasoning models), and I accept
  it; see L1 and L2 for its side effects.

## MEDIUM

**M1. `parseKeepChange` treats any line starting with "keep" or "change" as a heading, and silently corrupts the list.**
- `critique.ts:269`: `/^(keep|change)\s*:?\s*(.*)$/i` has an optional colon and no word boundary.
- Probe (run against this branch): `Keep:\n- 4px grid\nKeeping the accent is right.\nChange:\n- raise muted
  text\nChanges like this matter.` → `keep: ["4px grid", "ing the accent is right."]`,
  `change: ["raise muted text", "s like this matter."]`.
- Failure: a model writes a short prose line in the summary (common with reasoning models). The Keep/Change cards
  then show truncated fragments ("ing the accent…"), and the user can copy them. Nothing flags it: the result is
  non-null, so the "wasn't a clean list" fallback never shows.
- Fix: a heading needs a word boundary and either a colon or nothing after it:
  `/^(keep|changes?)\b\s*(?::\s*(.*))?$/i`. Unbulleted lines under a heading are ignored, not pushed.
- Test: add the probe to T3.25 (a "Keeping…" and a "Changes…" prose line must not create items).

**M2. Switching the flag off mid-run hides the panel but the run keeps calling the provider, with no Stop button.**
- When the flag goes false, `App.tsx` only moves the tab to Ask. The run lives in the module-level `critiqueStore`,
  and nothing calls `reset()`/`stop()` on a flag change (I grepped: no other caller).
- Failure: the owner unticks Labs → Critique during a run (the flag is watched live). The remaining calls, up to 9
  plus a retry, still go to Groq with the scan data, invisibly. That's spend and data sent after the user turned the
  feature off. The same applies after `?labs=1` is turned off in Options in another tab.
- Fix: when the flag flips to false, call `useCritique.getState().reset(null)`. Do it in the `Panel` effect, or in
  `critiqueStore` via `watchFlag`, which also works when the panel's tab is closed.
- Test: extend the T3.26 "switching it off" case: start a run with a slow mock, set the flag to false, and assert
  that `calls.length` stops growing and `phase` is `setup`.

## LOW

- **L1. The cap line understates tokens.** `estTokens` uses 250 output tokens per turn, but each turn may use up to
  1200 (1500 for the summary), and reasoning tokens count. With gpt-oss, the "~Nk tokens" shown can be well under
  the real figure, and the real figure is what the TPM limit counts. Fix: show a range, or estimate from
  `maxTokens` as an upper bound ("up to ~Nk").
- **L2. 4k-context providers can overflow.** WebLLM's default and Chrome built-in are 4096. The reserve of 1200
  output tokens, plus a system prompt of about 7.4k chars (JSON tokenizes at about 3 chars/token, so about 2.5k
  tokens), plus the 2000-char message floor, comes to about 4.4k tokens. Some turns may error with 'other' on local
  models. Fix: for small contexts, `maxTokens = min(1200, floor(contextTokens / 4))`, or note it as a known
  limitation (the owner tests with Groq at 128k).
- **L3. T3.18's persona check can't fail on the wrong persona.** `find(x => sys.includes(x.brief))` passes if *any*
  brief is present, so turn 2 using the brand brief would pass. The summary turn's brief isn't checked either. Fix:
  assert `calls[i].system` contains the brief of the expected persona in order, and `SUMMARY_BRIEF` for the last
  call.

Not findings: no global `fetch` stub. Every provider in these tests is an in-memory mock or a hand-written
provider, so a real request is impossible.
