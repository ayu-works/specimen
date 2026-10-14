# SPC-22 review, lens B + privacy, round 1

Reviewer: fresh lens-B reviewer · PR #25 at `7abaf1f` · 2026-10-15 · read-only. I read the code and did not run it.

**Totals: 0 CRITICAL · 2 HIGH · 3 MEDIUM · 6 LOW.**

What holds up: the abort paths (mid-stream, a quiet stream end, during backoff, before start), the fixed per-kind
error text (no `e.message`, no console logging in the new files), the sanitizer on every snapshot, later turns
built only from sanitized `done` turns, double-click Start (`controller` is set synchronously; the setup card
unmounts), a scan change aborting the run, and the guard against late results from an old run. For BYOK, closing the
side panel kills the document and its `fetch`, so a Groq run really stops. Nothing is sent with the flag off at
start, or with no provider (setup card only). Page data is truncated and inside one `<page_data>` per call.

---

## HIGH

### H1. On Groq's free tier, a default run will very likely fail at turn 2 or 3 with "still rate-limiting"
`critique.ts:411-423`, `DEFAULT_RETRY_MS = 8000`, one retry only.
Groq's published free-tier limits for `openai/gpt-oss-20b` are **8K TPM, 30 RPM, 200K tokens per day**
(console.groq.com/docs/rate-limits; limits apply per organization, not per key). Each call resends the system
prompt (≈ 3.5k tokens of page data plus the brief), the transcript, and up to 1,200 output tokens, so one call is
≈ 4.5–5.5k tokens. Groq answers in seconds, so turn 2 starts well inside the same minute.
- **Scenario:** the owner runs T3.27 on a free key. Turn 1 uses ≈ 5k of the 8K/min. Turn 2 gets a 429. The one 8 s
  backoff doesn't help, because the token window is about a minute, so the second 429 ends the run: "The provider is
  still rate-limiting requests…". The spike can't be evaluated on its intended setup. Also, a default run is ≈ 32k
  tokens, so 200K TPD allows ≈ 6 runs a day, fewer with retries.
- **Fix:** (a) honour the 429's `retry-after` / `x-ratelimit-reset-tokens` headers. `httpError` currently drops
  headers, so add an optional `retryAfterMs` to `ProviderError('rate')`, using that header without the body. Then (b)
  allow up to ~3 retries per turn, with the total wait capped at ~75 s, each cancellable by Stop, with the countdown
  shown (as now). Optionally (c), pace calls on the client when `provider.label` is Groq: hold a turn while the
  rolling 60 s token sum plus the next call's estimate is over ~7k. Add a T3.21 case: rate → `retryAfterMs: 30000` →
  the wait is 30 s, not 8 s. Put the free-tier arithmetic (≈ 4–5 min of TPM per default run; ≈ 6 runs a day) in the PR
  body's owner steps, so a 429 is expected and not read as a "no-go".

### H2. The flag isn't a build-time gate: once merged, the next CWS release ships the Labs card and the Critique tab, reachable with `?labs=1`
`options/main.tsx:83`, `lib/flags.ts`, `App.tsx` (static `import { Critique }`).
The plan's hard limit says "The published extension is unchanged", but the gate is only runtime storage. SPC-16 to
SPC-21 are planned for a v1.0.1 CWS release cut from `main`.
- **Scenario:** #25 merges. The orchestrator builds v1.0.1 from `main` for the audit fixes. The published extension
  now has the Labs card (any user who opens `options.html?labs=1`, for example from a forum post or a screenshot of
  this PR, can turn it on) and all of the critique code. An unreviewed-for-release feature that sends page data
  7–10× per run is now live in production, against the hard limit.
- **Fix (pick one, owner decides):** (a) gate at build time. Wrap the Labs card and the Critique tab/import in
  `import.meta.env.WXT_SPECIMEN_LABS === '1'` (a lazy import so it is dead-code-eliminated). The owner builds with
  `WXT_SPECIMEN_LABS=1 pnpm build`. Add a check (unit test or `scripts/` check) that a default build contains no
  `critique-view` / `labs` testid. Or (b) don't merge #25 to `main` until go/no-go: the owner tests from
  `exec/spc-22`. Either way, state it in the PR body and in plan.md.

## MEDIUM

### M1. Turning the flag off mid-run keeps the run going invisibly, with no Stop
`App.tsx` (`useEffect` that only switches the tab), `critiqueStore.ts` (module-level controller).
The plan says "Off = no tab, no code path reachable". Unticking Labs hides the tab and unmounts `<Critique/>`, but
`runCritique` keeps going.
- **Scenario:** the owner starts a 3 × 3 run (10 calls), then unticks Labs in Options to "turn it off". The remaining
  ≈ 8 calls (≈ 40k tokens, which also eats the Groq TPM/TPD from H1) are still sent to the provider. The Stop button
  is gone with the tab, so only a scan change or closing the panel stops them.
- **Fix:** in `Panel`'s flag effect, `if (!critique) useCritique.getState().reset(null)`. Add a T3.26 case: flag goes
  true → false mid-run → no further `chat` calls.

### M2. Switching provider or key mid-run keeps sending to the old provider, and the UI shows the new one
`critiqueStore.ts:49-55` (the `provider` captured at start), `Critique.tsx:220` (label from the current `ai.provider`).
- **Scenario A (privacy):** mid-run, the user switches Settings from Groq to local Gemma ("I don't want this going to
  Groq"), or removes or locks the Groq key. The run keeps sending page data plus the transcript to Groq with the
  captured key until all turns are done. CLAUDE.md: never send page data anywhere except the user's *chosen*
  provider. After the switch, Groq is no longer chosen.
- **Scenario B (misleading):** the progress line reads "Turn 4 of 7 · Gemma" while the calls go to Groq.
- **Fix:** record the provider at start (`runProvider` in the store). Where the provider is resolved (`Panel`, or
  `AiProvider` context, since `Critique` unmounts on tab switch), abort the run when `ai.provider !== runProvider`.
  `useAiResolution` already keeps the identity stable across polls, so identity comparison works. Show
  `runProvider.label` in the progress line. Add a test: change the injected provider mid-run → no more calls on the
  old one.

### M3. No per-turn timeout: a stalled stream hangs a turn indefinitely
`providers/http.ts` (no timeout), `runTurn`.
- **Scenario:** Groq accepts the request and then stalls (it can stall under load, or a captive network can hold the
  connection open). The turn shows the thinking mascot indefinitely. "Turn 3 of 7" never moves. Nothing tells the
  user whether to wait or stop.
- **Fix:** in `runTurn`, combine the run signal with an idle timeout. Use `AbortSignal.any([signal,
  idleTimer.signal])` and reset the timer on each delta, with ~45 s to the first token and ~20 s between tokens. A
  timeout maps to `network` (fixed text). Tell it apart from a user Stop by checking `signal.aborted`. Add a test with
  a hand-written provider that never yields.

## LOW

### L1. An empty reply from a reasoning model is marked `done` and still costs a call
`runTurn:431-433`. `gpt-oss-20b` can spend its whole 1,200 `max_tokens` on reasoning and return `''`. The turn is
`done`, shows "(no reply)", and is left out of the transcript. If it is the summary, the user sees "shown above as
written" above an empty bubble. **Fix:** with `raw.trim() === ''` and no abort, mark the turn
`error`/`other`-like ("The model returned no text; try another model"). For the summary, say "No summary was
produced". Optionally send `reasoning_effort: 'low'` for openai-compat gpt-oss (an adapter option, outside this lane:
note it for SPC follow-up).

### L2. The cost estimate leaves out reasoning tokens and Human messages
`critiquePlan`. gpt-oss reasoning is billed as output and is often 200–800 tokens a turn, so "~32k" can be ~40k+.
**Fix:** label the figure "≥ ~32k", or add a per-turn reasoning allowance when the model id matches `gpt-oss|r1|o\d`.

### L3. The prompt order prevents prefix caching, so each turn pays for the scan again
`critiqueSystemPrompt` puts the persona brief **before** the 14k-char `<page_data>`, so the system prefix differs per
persona. Groq and OpenAI-style automatic prefix caching (and Anthropic's `cache_control` later) can't reuse it. About
7 × 3.5k = 24k of a run's ≈ 32k tokens is the same scan resent. **Fix:** order the system prompt as `SHARED_RULES`,
`PAGE_DATA_RULE`, `<page_data>`, and then the persona or summary brief. This is cost only. Privacy is unchanged: the
same data goes to the same provider. The repeat is disclosed in the cap line.

### L4. A partial brand token can stay in a `stopped` or length-truncated turn
`safe(raw)` runs on the whole text, but a stream that stops mid-word ("…the Zentr") leaves a prefix that is not a
whole-word brand token. In a `stopped` turn it is shown permanently (it is not fed forward). In a turn cut by
`max_tokens` and marked `done`, it is also fed to the next turn. It can flash in any streaming snapshot too. Low
impact, because it is a prefix and not the name. **Fix (optional):** in non-final snapshots and in `stopped` turns,
drop a trailing partial word that is a prefix (≥ 3 chars) of a brand token.

### L5. A Human message sent during a retry backoff misses the retried request
`req` is built before `runTurn`, so a message queued during "retrying in 8s" only reaches the *next* reviewer,
although the user expects the one about to speak to answer it. **Fix:** call `takeHuman()` again before the retry,
or note it in the UI ("Queued for the next reviewer" is already accurate, so this is wording at most).

### L6. WebLLM: closing the side panel mid-turn doesn't stop local generation (audit H2, SPC-18)
For BYOK the `fetch` dies with the document. For WebLLM, the port disconnect doesn't interrupt `llmHost`, so the
GPU keeps generating up to 1,200 tokens and the next Ask waits. There is no cost or privacy impact. **Fix:** list it
under the PR's Known limitations next to H1 (SPC-18).

---

## Privacy summary
- **What is sent, per call:** the system prompt (persona brief, rules, `PAGE_DATA_RULE`, and `<page_data>` with the
  12 worst contrast pairs plus `compactScan`, truncated to `pageDataBudget`), plus one user message. The user message
  holds the sanitized transcript and the user's own Human lines, clipped to 1,000 characters. There is no host, title,
  headline sample or URL. Font family names are included, as in `ask()`.
- **How many times:** `personas × rounds + 1` calls (default 7, max 10). Each 429 retry adds one more request to the
  same turn. The scan is resent on every call (L3), which the cap line discloses.
- **With no flag or no provider:** nothing is sent. **After the flag is turned off, or the provider changed, mid-run:**
  data is still sent (M1, M2).
- **Keys and error bodies:** never shown and never logged in the new code (fixed `CRITIQUE_ERRORS`; no `console.*`).
- **Brand names:** sanitized on every turn, including the summary and the Copy text. The known gaps are the camelCase
  case (H3/SPC-17) and L4.

Sources: Groq rate limits, https://console.groq.com/docs/rate-limits (free tier `openai/gpt-oss-20b`: 30 RPM, 1K
RPD, 8K TPM, 200K TPD). The `retry-after` header on 429 comes from secondary sources: verify it on a real 429 before
relying on it.
