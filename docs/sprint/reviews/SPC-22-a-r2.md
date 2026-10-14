# SPC-22 (PR #25), PE lens A, round 2

Reviewer: pe-1b · 2026-10-15 · diff `7abaf1f..ed91231`

**APPROVED (lens A).** 0 CRITICAL · 0 HIGH · 0 MEDIUM · 2 LOW (notes only, no change needed for the spike).

## r1 findings
- **M1 fixed.** The heading regex is now `^(keep|changes?)\b\s*(?::\s*(.*))?$`, so "Keeping…" and "Changes like…"
  are prose. My probe is in T3.25.
- **M2 fixed.** `Panel` resets the run when the flag reads `false`. `useFlag` is `null` while loading, so a slow
  storage read can't reset a live run or bounce the tab. T3.26 drives the flag-off mid-run case and asserts the
  calls stop.
- **L1–L3 fixed.**
  - The cap line shows an est–max range.
  - `maxTokens` is `min(cap, ctx/4)`.
  - T3.18 checks each persona's brief in order, plus `SUMMARY_BRIEF`.

## Lens-B H1 (Groq free-tier 429) fix: checked
- **Pacing is reachable on the real path.** `PROVIDER_TPM` is keyed by `provider.id`, and the BYOK provider gets
  `id: preset.id` (`aiByok.ts` → `createOpenAICompat({ id: preset.id })`), so the Groq preset's provider is `'groq'`.
  The test's `id: 'groq'` matches production.
- **`paceWait` is correct.** It drops the oldest entries in the window until the next call fits, and waits until
  that entry expires. With an empty window it sends at once. The unit cases cover fit, wait, multi-entry and expiry.
- **Every wait can be cancelled.**
  - A pacing wait and each of the 3 retry waits (20/30/30 s) use `backoff(signal)`, and Stop resolves them at once.
    Both cases are tested and make no further call.
  - The stall timer runs only around a stream, not during a wait.
  - Stop beats stall: `signal.aborted` is checked before `stalled`, and that's tested.
- **The retries are cheap and bounded.** A 429 is a rejected request (no tokens billed), the delays array length is
  the retry limit, and the turn count is unchanged. Changing my r0 condition from "1 retry" to 3 is accepted.
- **Provider guard.** `useAi` keeps the same provider object across polls unless the state, label or detail
  changes. `watchAi` fires only on AI settings, secret or session keys. So `guardProvider` stops a run only on a
  real provider or key change, or a same-value re-save in Options (conservative and fine). The WebLLM reload
  exception is correct, because nothing leaves the device.

## Contract question: `retryAfterMs` on `ProviderError('rate')`
Skipping it is right for the spike, since pacing plus fixed waits cover the case. If it's wanted later, it's an
additive optional field on a shared contract (`LLMProvider`/`ProviderError`): a PE plan plus the owner's OK, and it
must read only the header, never the body (H5).

## LOW (notes)
- **L1. The TPM is per model, not per provider.** 8K is `gpt-oss-20b`'s free-tier limit. On another Groq model with
  a lower TPM, some 429s get through. The 3 retries absorb them, and the owner sees "Rate limited… waiting". A paid
  Groq key is paced to 8K and is slower than needed. Fine for a spike. If it ships, key the limit by model, or learn
  it from the first 429.
- **L2. A single call's estimate can exceed the TPM.** For example, the summary with a full transcript estimates
  about 9k (chars/3 + 1500). `paceWait` then waits for an empty window and sends anyway. The real token count is
  lower (the chars/3 estimate is conservative), so this is unlikely to matter. Watch for it in T3.27.

Not reviewed here: lens-B H2 (the runtime flag would ship in a release) is the owner's decision.
