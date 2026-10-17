# SPC-21 lens A r1 (PE pe-b2, 2026-10-17)

**Verdict: APPROVED, 0 CRITICAL / 0 HIGH / 0 MEDIUM / 1 LOW.**

Reviewed the scope-cut working tree before the PR (tests only: `test/helpers/chrome.ts`, `test/helpers/gpu.ts`,
`test/chromeStub.test.ts`, appends to `options.test.tsx`, `localGemma.test.tsx`, `ai/llmHost.test.ts`, TESTING.md rows).
`backgroundScan.ts`, the wxt/playwright/e2e config and `phase5.spec.ts` match main (SPC-44 owns the debugger removal).
I ran the 4 files: 54/54 green.

## Checks
- **Back-compat:** with no options, `permissions` returns true for everything, as before. `contains`/`request`
  stay `vi.fn`, so existing `.mockResolvedValue` overrides still work. The self-test pins the default.
- **The tests can fail:**
  - T3.13 deny/throw: main's stub always grants, so the "did not grant access" text never shows.
  - "Not asked again": `request` is a spy, and the stub's `has()` would hide a needless call, so the spy assertion is what catches it.
  - T3.11 throw: without `hasGpu`'s try/catch, "GPU process crashed" doesn't match the unsupported regex (llmHost.ts:70), so `kind` would differ.
  - T3.17 drives each `gpuStatus` branch (LocalGemma.tsx:12-23).
- **Key handling (T3.10 rule):** the deny case asserts the key is in `storage.local` and `storage.sync.set` is never called.
- **Cleanup:** `stubGpu` restores the own-property descriptor in `finally`. llmHost's `vi.stubGlobal('navigator')`
  is re-stubbed in every `beforeEach` (line 260).

## LOW
- **L1 (wording):** `NOT_IN_MANIFEST`'s doc comment and `chromeStub.test.ts` use `debugger` as the example
  permission. After SPC-44 the extension has no `debugger`, so the example will mislead. Fix: say "a permission not
  in the manifest" and use a neutral name in the test (e.g. `permissions: ['tabCapture']`). Optional; no re-review.

When the PR is up, I'll check its diff matches this tree and that `pnpm gate` is green.
