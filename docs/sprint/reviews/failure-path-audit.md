# SPC-13: failure-path audit of the existing suites

PE, 2026-10-14, at `main` ff7c180. Read-only: no code was changed. The audit covers `packages/core`, `packages/ai` and
`apps/extension` (unit, component and e2e). It asks one question per claim: does a test **drive** the failure the code
or the docs say is handled, and would that test go red if the handling broke? Three read-only sub-audits gathered the
findings. Behaviour marked *(probe)* was confirmed by running a throwaway script against `core` in a scratchpad. I
re-checked every HIGH against the source myself.

**Totals: 0 CRITICAL · 13 HIGH · 21 MEDIUM · 12 LOW.**

Severity:
- **CRITICAL:** an untested failure that leaks keys or page data, or silently corrupts stored data. There are none: no
  path found sends data anywhere unexpected or overwrites good rows.
- **HIGH:** a documented failure-handling claim with no test driving it, a test that can't fail on its claimed path,
  or a real bug on a failure path that no test catches.
- **MEDIUM:** partial coverage. **LOW:** nice to have.

"Fix test" names the test that would cover the gap, under the T-ID it belongs to.

---

## HIGH

### Bugs that exist today (the test would fail on `main`)

**H1. Aborting one local chat truncates another, and the truncated chat reports success.**
- Code: `apps/extension/src/entrypoints/offscreen/llmHost.ts:186-188`. `abort` calls the engine-wide
  `interruptGenerate()`. When chat B is aborted while still queued behind chat A, A's stream ends early, A's loop sees no
  abort for its own id, and it sends `done` (`:150`). The caller then treats partial text as a complete answer.
- Test today: `apps/extension/test/ai/llmHost.test.ts`, with no concurrent case.
- Fix test (T3.11): queue chats A and B, abort B, and assert A gets every delta, or gets `error`, and never `done`
  after a cut-short stream. The code fix is to interrupt only when the aborted id is the one running.

**H2. A Port disconnect mid-chat doesn't stop generation.**
- Code: `llmHost.ts:136-156, 214`. `onDisconnect` only removes the port and never marks the running id as aborted. The
  closed panel's generation runs to the end and blocks `chatChain`, so the next chat waits for it.
- Test today: the fake port's `onDisconnect` is a no-op.
- Fix test (T3.11): disconnect during chat A, send chat B on a new port, and assert B starts without waiting for A to
  finish.

**H3. A brand in a camelCase CSS variable leaks into DESIGN.md.**
- Code: `packages/core/src/generate/sanitize.ts:62-63`. The word boundaries `(?<![\p{L}\p{N}])` and `(?![\p{L}\p{N}])`
  don't match `zentrix` inside `--zentrixBlue`. `generate/designmd.ts:297` prints CSS variable names. *(probe:
  `--zentrixBlue` on zentrix.com appears in DESIGN.md; `--zentrix-blue` is filtered.)*
- Test today: T2.03 (`test/generate.test.ts`) checks prompts only. Nothing checks DESIGN.md for brand names.
- Fix test (T2.03): `generateDesignMd` on a scan with `cssVariables: {'--zentrixBlue': '#123'}` and host `zentrix.com`
  doesn't contain `zentrix` in any case.

**H4. `migrate()` accepts rows that later crash the generators.**
- Code: `packages/core/src/schema/scan.ts:23` (`hex: z.string()`). Roles are never checked against palette ids.
- *(probe)* `hex: 'zzz'` passes `migrate()`, then `generatePrompt` and `generateDesignMd` throw "Cannot convert to
  oklch". A role pointing at an id that isn't in the palette also passes, and the prompt silently drops it.
- `apps/extension/src/lib/db.ts:87` relies on "re-validated through migrate()", so one corrupt imported row breaks
  Generate for that scan.
- Fix test (T1.01): `migrate()` throws on a non-hex `hex` and on a role id that isn't in the palette. T4.03: importing
  such a scan counts it as skipped.

**H5. API error bodies are copied into user-facing error text, and the test that should catch a key in them can't
fail.**
- Code: `packages/ai/src/errors.ts:4-23` copies up to 200 characters of the provider's error body into 401, 400, 404
  and 5xx messages.
- Test today: `packages/ai/src/providers/providers.test.ts:252` uses the body `'bad'`, so the key could never be in the
  message.
- Some providers echo part or all of the key ("Incorrect API key provided: sk-…"). Those messages are shown in the UI
  and may be persisted with Ask history, which goes against "keys are never logged".
- Fix test (T3.05): 401 with body `{"error":{"message":"Incorrect API key provided: <the request's key>"}}`. Assert the
  ProviderError message doesn't contain the key, or any 8 or more characters of it.

**H6. An import that fails partway duplicates scans on retry.**
- Code: `apps/extension/src/lib/libraryIO.ts:61-66` saves scan by scan, with no transaction. If save #k fails, scans
  1..k-1 stay saved and the raw Dexie error is shown. On retry those ids now collide and get new UUIDs, so every scan
  already imported is stored twice.
- Test today: none.
- Fix test (T4.03): stub the 2nd `db.scans.put` to reject. Assert either nothing was stored (wrap the loop in
  `db.transaction('rw', db.scans, db.thumbs, …)`) or the error reports how many were saved. Then re-import and assert
  there are no duplicate scans by content.

### Documented failure handling that no test drives

**H7. A failed Library save is silent.**
- Code: `apps/extension/src/lib/scanFlow.ts:47-52` swallows `saveScan` errors (quota, private mode). The panel shows
  the scan as done, while ARCHITECTURE §9 says every successful scan is saved. A "success that did nothing".
- Test today: none.
- Fix test (T4.08 unit variant): make `db.scans.put` reject, and assert the outcome or the UI says "not saved to
  Library".

**H8. Scan failures the user can hit have no tests.**
- Code: `runScan.ts:12-14`, `friendlyScanError` (`scanFlow.ts:6-13`), `ensureSiteAccess` (`:19-23`).
- Untested: a chrome:// page, a Chrome Web Store tab, the site-access prompt declined, the tab closed mid-scan
  (`tabs.get` throws), and a failed injection.
- Fix test (T1.11): a table test over `friendlyScanError` inputs, and `runTabScan` with `permissions.request` resolving
  `false` asserting the store's error text.

**H9. A failed screenshot is supposed to leave the scan working, and that's never driven.**
- Code: `apps/extension/src/entrypoints/background.ts:89-95`. Every e2e calls `bringToFront`, so the capture always
  succeeds.
- Fix test (T1.11): scan a tab that isn't in front. Assert `screenshot === ''`, the scan is still extracted and saved,
  and it has no thumb row.

**H10. Debugger colour-scheme emulation has zero tests, and T5.03 can't fail on its emulation path.**
- Code: `background.ts:42-61` (attach, `setEmulatedMedia`, detach).
- T5.04 uses the page's class switch, so emulation never runs. In T5.03 (`e2e/phase5.spec.ts:84-104`) the expects are
  conditional: the "not captured" branch passes, even though the e2e build pre-grants `debugger` (`wxt.config.ts`).
- Fix test (T5.03/T5.04):
  - When `debugger` is granted, require `variants.mobile`.
  - A unit test where `attach` rejects ("another debugger attached") or the sampler throws asserts `detach` is still
    called and the UI shows "Capture failed".

**H11. Cross-origin CSS (T1.12) only tests a fake fetcher.**
- Code: `sampler.spec.ts:206` hands the sampler a `fetchCss` that returns null. The background's
  `permissions.contains` check (`background.ts:106`) never runs without permission.
- Permission denied, a 404 and a network error all give the same warning. `fetchCss` throwing (`sampler/cssom.ts:199`),
  the 2 MB cut-off and the 24-URL cap are untested.
- The cssText parser also blows the stack on deep nesting: *(probe)* 20k nested `@media` gives a RangeError at
  `packages/core/src/cssText.ts:191`, and the call site doesn't catch it. A hostile page can therefore fail the scan,
  which goes against "scan still succeeds".
- Fix tests (T1.12):
  - Unit-test `css.fetch` with `contains → false` against `fetch → 404`, and assert distinct warnings.
  - `parseCssText('@media a{'.repeat(2e4) + '}'.repeat(2e4))` doesn't throw.

**H12. chromeBuiltin has no tests, although T3.06 says "every adapter".**
- Code: `packages/ai/src/providers/chromeBuiltin.ts:49-96`.
- Untested: each `status()` state, `unsupported` when `LanguageModel` is missing, abort before and during the stream,
  and `session.destroy()` on error.
- Fix test (T3.06): stub `globalThis.LanguageModel`, abort mid-stream, and expect `kind: 'aborted'` and `destroy`
  called.

**H13. Permission denied when saving a key, and missing WebGPU on the host, are never driven.**
- Permission: the shared stub `apps/extension/test/helpers/chrome.ts:52-53` always grants, so `aiSettings.ts:214-223`
  and `Byok.tsx:128,166` never see a refusal.
- WebGPU: `navigator.gpu` is always stubbed as present, so `llmHost.ts:45-61` never takes the no-GPU branch.
- Fix tests:
  - T3.13: `permissions.request → false` on Save shows the "did not grant access" message, and the key is in
    `storage.local` only.
  - T3.11/T3.17: `navigator = {}`, then `load` returns error `kind: 'unsupported'` and `status` returns `gpu: false`.

---

## MEDIUM

| # | File | Missing failure scenario | Fix test |
|---|---|---|---|
| M1 | `packages/ai/src/providers/openaiCompat.ts:50-61`, `gemini.ts:55-63`, `anthropic.ts:63-79`, `http.ts:22` | A mid-stream `{"error":…}` event is ignored. An Anthropic stream with no `message_stop`, or an empty 200 stream, counts as success. A null body is untested | T3.02-04: a stream of `data: {"error":{"message":"x"}}` rejects; an empty stream rejects or is flagged |
| M2 | `packages/ai/src/features/vibe.ts:96-100` | `{"summary":"","keywords":[]}` fails zod and is saved as the summary text "summary:,keywords:[]". "Returned no description" and other `IMAGE_REJECTED` phrasings are untested | Mock returns `{"summary":""}`; expect a throw, nothing stored |
| M3 | `packages/ai/src/features/polishPrompt.ts:87-102` | Fallback reasons untested: empty output, `sanitize` stripping a font or brand token (wrongly reported as "AI changed values"), a non-ProviderError throw | T3.07: mock `''` gives `{polished:false, reason:/nothing/}` |
| M4 | `packages/ai/src/features/ask.ts:44-45`, `Ask.tsx:82-84` | Only the question is cut (to 2000 chars, untested). 12 history turns have no size limit, and aborted partial answers are replayed as history, so the 4k-token Gemma context can overflow | T3.08: a 5000-char question gives a 2000-char message, and the total request size is bounded |
| M5 | `packages/ai/src/providers/webllm.ts:96-126`, `aiRuntime.ts:60` | Abort during `load`; an error event during `remove()`; disconnect during `load` or `status`. `status()` has no timeout, so the UI hangs if the host never replies | `remove` with an error event rejects with that kind; `status` with no reply times out |
| M6 | `llmHost.ts:62-63, 190-200` | `deleteModelAllInfoInCache` rejecting; deleting the loaded model; out-of-memory on load | Delete rejects and gives an `error` event; deleting the loaded model disposes the engine |
| M7 | `apps/extension/src/lib/aiSettings.ts:134-139, 188-199` | Corrupt ciphertext or a salt mismatch should leave the key `locked`. A malformed salt makes `unlockKeys` throw, because `deriveRawKey` runs outside the try | T3.10: `ct='!!'` gives `locked`; `unlockKeys` resolves `false` |
| M8 | `apps/extension/src/components/Library/index.tsx:57-60,131-151` | 500-scan cap: shown only once, "Not now" saved, confirm declined deletes nothing, accepted deletes exactly the oldest. A `deleteScans` rejection is unhandled. The "export was downloaded" note shows without checking the download | C test with 501 scans, for each branch |
| M9 | `apps/extension/src/lib/messaging.ts:76-108`, `background.ts:125-140` | `send` with no receiver (service-worker restart mid-scan); a "not implemented" reply; `ensureOffscreen` when the document exists; two concurrent ensures ("Only a single offscreen document") | Unit `listen`/`send`; `ensureOffscreen` with `getContexts → [{}]` and with `createDocument` rejecting |
| M10 | `apps/extension/src/lib/captureFlow.ts:47-97` | Mobile capture: `attach` throws, `scan.run` rejects during emulation, the tab load times out or the tab closes. Each should still remove the window and end as `mobile: 'failed'` (only the too-wide case is tested) | T5.03 unit: each failure removes the window and detaches |
| M11 | `apps/extension/src/hooks/useShortcut.ts:18-31` | A stale `shortcut.pending` (over 10 s), no host permission, a double consume | T2.14 unit: stale gives no scan; double consume gives one scan |
| M12 | `Generate.tsx:297`, `FidelityCheck.tsx:151`, `Palette.tsx:18`, `e2e/helpers.ts:52-56` | Clipboard rejection ("Copy failed") is never tested. The e2e clipboard shim swallows real `writeText` errors, so T5.09's copy check passes even when the write fails | T2.12: `writeText` rejects and "Copy failed" is shown; the shim rethrows |
| M13 | `apps/extension/src/components/Library/ScanCard.tsx:74-98` | A failed rename, tag, favourite or delete has no catch, so the edit is lost with no message. The `saveCompose` "Could not save" toast is untested | C test: `db.scans.update` rejects and an error is shown |
| M14 | `libraryIO.ts:51`, `db.ts:69-78` | Import accepts `version: 2` (only the type is checked). Duplicate ids within one file are untested. `saveScan` writes the scan, then the thumb, with no transaction, so a failed thumb write leaves a scan with no thumb | T4.03: version 2 rejected, in-file duplicates get new ids; T4.01: the thumb write fails, then both rows or neither |
| M15 | `test/generate.test.ts:110` (T2.03) | The guardrail is checked against its own `brandTokens()`. Host forms are never driven with a synthetic host: subdomain, `WWW.` uppercase, `.co.uk` (the second-level domain becomes `co`), a port, a title-only brand | T2.03 table over `app.x.io`, `WWW.X.COM`, `shop.x.co.uk`, `x.dev:8080` and a title-only brand: the output has no `x` |
| M16 | `packages/core/src/generate/fonts.ts:61-73` | The branded-font placeholder is hidden by `sanitize`: on cal it strips "Cal" anyway, so T2.03 passes even if the `branded` branch breaks | A family named `Zentrix Grotesk` gives "custom … face" plus the alternative |
| M17 | `packages/core/src/compose/index.ts:98-122` | Compose drops `a11y` and `components` *(probe)*, so a composed prompt and DESIGN.md lose their AA lines. Copied `variants` aren't contrast-fixed | T4.04: `compose(...).a11y.pairs.length > 0` |
| M18 | `packages/core/src/color/parse.ts:23` | `rgb(none 0 0)` gives `r: NaN`, then `contrast` returns NaN and `ratio: NaN` is stored *(probe)*. `currentColor`, `var()` and `color-mix()` return null (correct), but nothing tests it | T1.02: `parseColor('rgb(none 0 0)')` is null or finite; null for currentColor and var() |
| M19 | `packages/core/src/extract/index.ts:60` (T1.26) | `extract()` is never run on a degenerate RawPage: no samples or sections, all transparent, NaN sizes. It works today *(probe)*, but nothing locks that in. T2.04's 800-token minimum fails on such a scan (652 tokens) | T1.26: degenerate RawPage validates; T2.04: decide the bound for degenerate scans |
| M20 | `packages/core/src/diff/index.ts:130,239-250,543-566` | An empty source against a full build scores 85. `s.size === 0` divides by zero. "Role missing in build scores 0" and the `missing` type slot are never driven | T5.06: delete the accent from the build, then colors < 100 and the delta's actual is `'missing'` |
| M21 | `packages/core/src/extract/merge.ts:85-102` (T5.08) | "Roles stable" is tested only by merging a page with itself. Conflicting accents and the tie-break rule are never asserted | `mergeScans([a, a2, b])` picks a's accent |

## LOW

- **L1.** The console-spy "key not logged" tests (`aiSettings.test.ts:107`, `options.test.tsx:144`) can't catch a leak
  today, because `src` has no `console.*` calls. They only guard future regressions.
- **L2.** T3.06's mid-stream abort (`providers.test.ts:270`) passes because the stub stream errors on abort, not
  because `sse.ts` calls `reader.cancel`. Use a stub that ignores the signal.
- **L3.** No component test covers AI error UI: Ask provider errors, Generate's "Kept the original" notice, Vibe
  errors.
- **L4.** `deleteScans` leaves `composes` rows pointing at deleted scans (`db.ts:118-124`).
- **L5.** The overlay on a page that blocks injection ("Overlay unavailable", `Inspect/index.tsx:57`) and the
  Library-unavailable fallback (`Library/index.tsx:52`) are untested.
- **L6.** Reconnecting the inspector Port after the panel closes is untested.
- **L7.** The compose contrast fix-up "no passing variant" branch (`compose/index.ts:55-58`) is effectively unreachable
  at 4.5 and 3 *(probe: 0 of 4000 random pairs)*. If it is ever reached, its warning would wrongly claim AA.
- **L8.** T4.06 asserts ≥ 4.5 where the docs say ≥ 7 for textPrimary. Muted, link and semantic roles at ≥ 3, and
  derivation with no background role, are unchecked.
- **L9.** cssText: an unbalanced `url(` swallows the rest of the sheet, and the malformed-input test doesn't assert
  what's lost.
- **L10.** Schema rejection is tested on 3 fields only. Version 0, a string version and a missing version give raw zod
  errors.
- **L11.** The production fallback (`sanitize.ts:121`) and its dev-mode throw are never driven.
- **L12.** T2.11 purity never runs on scans that have `variants`.

## Well covered (no action)
- **Providers:** HTTP 401, 403, 429, 404 and 5xx plus offline mapping for openai, anthropic and gemini. A pre-aborted
  signal skips the fetch. SSE edge cases. Anthropic mid-stream error events.
- **WebLLM client:** a dropped port, an error mid-stream, and the no-GPU or not-downloaded refusals.
- **polishPrompt:** detects changed hex, px or font values.
- **Page text:** `<page_data>` neutralisation and truncation.
- **Secrets:** wrong passphrase, tamper detection, `storage.sync` never written.
- **Import:** rejects non-JSON, foreign, all-invalid and oversized files, and files from a newer schema. It runs
  migrations and handles a collision with an existing id. Delete cascades to thumbs and chats, and invalid stored rows
  are skipped.
- **core:** colour maths references, clustering, v1/v2→v3 migrations and v4 rejection, fixtures round-tripping,
  generator determinism, injection text never leaking.
- **Extension:** manifest permissions (T0.03), overlay isolation (T1.33), and service-worker console-error checks in
  e2e.

## For the orchestrator: suggested tickets (HIGH)
A logical grouping, each with tests that drive the failure:
1. **llmHost concurrency:** H1, H2 (plus M6). These are real bugs, so the code fix ships with the test.
2. **Guardrail and schema integrity in core:** H3, H4 (plus M15, M16).
3. **Provider error text and adapters:** H5, H12 (plus M1, M3).
4. **Library write atomicity:** H6, H7 (plus M14, M13).
5. **Scan failure paths in the extension:** H8, H9, H11 (plus M9).
6. **Permission-denied and no-GPU paths:** H10, H13. This needs an e2e flavour or stubs that can *deny*. Today the e2e
   build pre-grants `<all_urls>` and `debugger`, so no e2e test can drive a refusal.
