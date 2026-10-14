# SPC-16 review, lens A, round 1

Reviewer: pe-99 (PE). PR #28, head `147a3eb`. 2026-10-15.
**Verdict: APPROVED. 0 CRITICAL / 0 HIGH / 0 MEDIUM / 2 LOW.**
- Condition: CI `gate` must be green on `147a3eb`; it was pending when I checked.
- The LOWs are cheap. Fold them with no re-review, or say why not.

## Checked and fine (the 5 plan conditions)
1. **No body text in `cause`.**
   - `httpError` builds every message from fixed text with no `cause`.
   - `mapThrown(e, { fixedText: true })` drops the thrown text and the `cause` on the HTTP path (`postSse`, `models.getJson`).
   - `streamError` reads only `type`/`code`/`status`.
   - The leak test checks `message`, `String(e)`, `stack`, `JSON` and the `cause` with its own message and stack, for
     every status × body shape × adapter + `listModels`, and asserts `cause` is undefined.
2. **Vibe's image fallback** compares with `=== IMAGE_REJECTED_TEXT`. The regex lives only in `errors.ts`. The
   ProviderError shape and kinds are unchanged, so the LLMProvider contract holds and Council's per-kind mapping and
   rate back-off are unaffected. A mid-stream overload or `RESOURCE_EXHAUSTED` maps to `rate`.
3. **`scrubLegacyProviderText`** is exported, pure and idempotent, and tested on the old suffix shapes. The stored-chat
   scrub is in SPC-26.
4. **URL and header text:** no message in the adapters or `models.ts` is built from the URL, headers or init. Gemini
   sends its key in a header, not `?key=`. The TypeError-with-URL case is tested.
5. **chromeBuiltin:** `destroy()` is wrapped, so a throwing `destroy()` neither masks the error nor fails a finished
   answer. Tested, along with the full status, abort and destroy matrix.

Also checked:
- **Empty and cut-off streams:** a 200 with no events rejects, and Anthropic without `message_stop` rejects as
  `network` after yielding the partial text.
- **Abort still wins:** `sseEvents` throws `AbortError` on abort, so an aborted stream never becomes the "empty" error,
  and the engine checks `signal.aborted` first (SPC-22 T3.20 holds).
- **polishPrompt (M3):** the "filtered" reason applies only when every missing value is one the sanitizer itself
  removes from the original.
- **TESTING.md:** the T3.05/T3.06 rewording keeps their meaning.

## L1 (LOW): `KEY_SHAPES` misses some preset key formats
`errors.ts` redacts `sk-`, `sk-ant-`, `gsk_` and `AIza…`. The presets also include xAI (`xai-…`), Together (64 hex) and
Mistral (32 alphanumeric). The legacy suffix strip covers the main echo path (`httpError`). But old *unprefixed* text,
such as the pre-SPC-16 Anthropic mid-stream message or the `mapThrown` fallback, is only cleaned by `KEY_SHAPES`.
**Fix:** add `xai-[A-Za-z0-9_-]{8,}` and a generic run of 32 or more `[A-Za-z0-9]` characters to `KEY_SHAPES`. Error
text never legitimately holds such a run. Add one test row for each.

## L2 (LOW): the broad image regex can mislabel a 400 as "This model can't read images."
The image check (`/image|vision|…/`) now runs before the model-gone check. A 400 such as "The model
`gpt-4-vision-preview` has been deprecated" becomes "This model can't read images." in Ask, where no image was sent,
instead of "This model isn't available…". Vibe's retry is fine either way.
**Fix:** run the model-gone test (`/model.*(not (exist|found)|decommission|deprecat)/`) before the image test. Add a
test with that body → the model-unavailable text.
