# SPC-55 lens B r1 (second reviewer, 2026-10-17)

PR #55 (`exec/spc-55` @ 490f841, base `exec/spc-46`): `features/vibe.ts`, `vibe.test.ts` (T3.35), TESTING.md row.
Lens: real provider behaviour. Read-only review; nothing was run against a real provider.

**Verdict: CHANGES REQUESTED. 1 CRITICAL · 0 HIGH · 2 MEDIUM · 2 LOW.**

## CRITICAL

### C1. On the Groq free tier, `max_tokens` 10000 alone is over the 8000 TPM limit, so the owner's exact case can still fail
The repo already models this: `critique.ts` has `PROVIDER_TPM = { groq: 8000 }` ("Groq free tier: 8K TPM for
gpt-oss-20b") and `callTokens()` counts **input + the full maxTokens** against TPM ("Pacing reserves each call's full
maxTokens"). Groq checks one request's *requested* tokens against TPM before it runs it. A community report shows a
413 "Request too large for model openai/gpt-oss-20b … tokens per minute (TPM): Limit 8000, Requested 33128" with 0
tokens logged, which is the reserved output budget
(https://community.groq.com/t/gpt-oss-20b-free-tier-getting-413-errors/1411). The sprint budget plans no paid calls,
so the owner's key is most likely free tier.

**Scenario:** Groq preset, `openai/gpt-oss-20b`, ctx 128000 → cap `min(10000, 32000)` = 10000. Requested ≈ 10000 +
~1–5k input > 8000 → HTTP 413 on **every** first call. What happens next depends on Groq's wording:
- Groq's TPM 413 text normally ends "Visit https://console.groq.com/docs/rate-limits for more information".
  `httpError` tests `/rate[_ -]?limit/` on the detail **before** the too-long check, so this becomes kind `rate`. vibe
  never retries `rate`, and the user is told "The provider is rate-limiting requests. Wait a minute and try again",
  which never helps because the request itself is too large. **Vibe on the ticket's model stops working on every run.**
- Without that URL, "Request too large" maps to `TOO_LONG_TEXT`, and the run caps down to 4096. 4096 + input still
  exceeds 8000 once the page data is over ~3.7k tokens (`pageDataBudget(128k)` = 14000 chars ≈ 4.7k tokens). The
  user then sees "too long … pick a model with a larger context" on a model with 128k context. Even when it works,
  every vibe makes one wasted call first.

No test covers a 413 or TPM response, so the gate can't catch this. The owner's manual test in the PR body will hit
it on a free key.

**Fix:** size the first cap to the provider's TPM, using the same accounting as critique. Export `PROVIDER_TPM` and
`callTokens` (or a small `tpmCap()` helper) from one place. Then set
`maxTokens = min(10000, quarter, tpm − ceil(inputChars / 3) − 256)` when `PROVIDER_TPM[provider.id]` is set. That is
~6k for a typical scan, which is still plenty for gpt-oss reasoning on a ~100-token answer. Apply the same limit to
the cap-down value. **Test (T3.35):** the Groq stub answers 413 with Groq's real wording (including the
`docs/rate-limits` URL) whenever `max_tokens + input/3 > 8000`. Assert that vibe resolves in **1** fetch with the
default `scan`, and with a scan whose compact data is near the 14000-char budget. The test must fail on 490f841.
Also ask the owner to confirm their Groq tier when they run the manual test.

## MEDIUM

### M1. With #44 (SPC-40), a retry inherits the 30 s *gap* timer, not the 120 s first-text timer
#44 wraps `provider.chat` and arms `VIBE_TIMEOUT_MS` (120 s) **once** per run, then `VIBE_GAP_MS` (30 s) after each
delta. The abort does bound the whole run including retries (`ctl.signal` reaches every attempt, aborts map to
`aborted`, and that is never retried), so that part is fine. But when call 1 streamed some text and then failed
mid-stream (the `json_validate_failed` path can stream content first), calls 2 and 3 only get the 30 s left on the gap
timer before their first token. A reasoning model doesn't stream its hidden reasoning as content. With a cap raised
from 1200 to 10000, it can now think for well over 30 s on a slower provider (OpenRouter/DeepSeek-R1, xAI
grok-3-mini). The retry is then killed with "No answer from the model", even though the retry was the fix.

**Fix (in whichever of #44 / #55 lands second):** in #44's `watched.chat`, call `arm(VIBE_TIMEOUT_MS)` at the start
of each `chat()` call, since each retry is a fresh request. Add a test: call 1 streams, then errors mid-stream; call 2
sends its first text after 40 s on fake timers, and the run resolves. Flag this on SPC-40 so it isn't lost in the
merge.

### M2. OpenRouter reserves credits for the full `max_tokens`, so the 10k cap can turn into an unretried HTTP 402
OpenRouter returns 402 "This request requires more credits, or fewer max_tokens. You requested up to 10000 tokens, but
can only afford N" when the balance can't cover `max_tokens × output price`. For example, a paid model at $15/M output
reserves $0.15 per vibe, and 10× more than at #54's 1200. `httpError` maps 402 to
`Request failed with HTTP 402.` (kind `other`), which matches no vibe remedy. A user with a small balance who could
run vibe before now gets a bare "HTTP 402".
**Fix:** treat `message === 'Request failed with HTTP 402.'` as a cap-down trigger too. That's one extra call, and a
402 is not billed. Better: add a fixed "out of credit / lower max tokens" text in `httpError` in #52's lane. Test it
with a fake 402 body that is accepted at 4096.

## LOW

### L1. The generic-400 cap-down also fires on 400s that have nothing to do with the cap
Some 400s match only the generic "rejected the request (HTTP 400)" text: Anthropic "Your credit balance is too low",
"Image too large: max 20MB", or a Custom endpoint that rejects `response_format`. Each now gets one identical retry at
4096 before the same error. 400s aren't billed, so this only costs latency. But the `response_format` case is exactly
where JSON-off would help, and it never gets JSON-off.
**Fix (optional):** when the cap-down retry fails with the generic 400 again, use the content remedy (JSON off) as
the last call instead of rethrowing. This stays within 3 calls. Otherwise, say in the PR body that this is not
covered (the handoff already notes it).

### L2. A mid-stream retry can bill twice, and it also retries server-side failures with JSON off
`MID_STREAM_TEXT` also comes from Mistral `finish_reason: error`, DeepSeek `insufficient_system_resource`, and
Anthropic or Gemini `api_error` / INTERNAL events. Call 1 may already have produced billed tokens (reasoning plus
partial text). The retry is bounded (at most 3 calls, each up to the cap), and dropping JSON there is harmless,
because `extractJson` plus the summary fallback still parse prose and fenced JSON (tested). It still costs the
user's key.
**Fix:** none needed. Add one line in the PR body: "a provider error mid-answer is retried once; the first attempt
may be billed".

## Checked and fine
- **Call budget:** two one-shot flags, so at most 3 calls. The exact-3 test pins it. Only kind `other` is retried, so
  abort, `rate` (429, Groq or OpenAI `insufficient_quota`) and `auth` (401/403, "api key" 400) are never retried.
  `TRUNCATED`, `FILTERED` and `CUT_SHORT` are rethrown.
- **Stop:** the vibe card has no Stop button on this base, and #44's timeout aborts. `postSse` throws on an
  already-aborted signal before `fetch`, so no call is made after an abort.
- **Anthropic:** a 4k/8k-output model gets a 400 "max_tokens: 10000 > 4096" → `TOO_LONG` → retried at 4096, correct.
  Anthropic doesn't reserve credit for `max_tokens`.
- **Gemini:** an 8k-output model's camelCase 400 → generic → capped down. Tested through the real `createGemini`.
- **DeepSeek `deepseek-chat`** (8192 max): its "max_tokens" 400 → `TOO_LONG` → 4096, correct.
- **OpenAI o-series:** 2 calls, then `TOO_LONG` is rethrown. No loop. The wording is misleading, which SPC-56
  tracks.
- **Local Gemma / Chrome built-in:** ctx 4096 → cap 1024. The cap-down is skipped (1024 is not smaller than 1024), and
  these adapters never emit `MID_STREAM`, `TOO_LONG` or the generic-400 texts, so no retry path runs. The input
  (≤ 6553 chars ≈ 2.2k tokens) plus 1024 fits 4096. Ollama and LM Studio (8000) → cap 2000, with no cap-down.
- **JSON off:** `extractJson` handles fenced or embedded JSON, and prose falls back to a clamped, sanitized summary
  (tested, including a brand).
- **Tests:** they use a stubbed `fetch` and fake SSE/JSON bodies only, with no network. They drive the real adapters.
  The retry tests can't pass on the old vibe.ts, which never retried `MID_STREAM` or a 400.
