# SPC-21 lens B r1 (second reviewer, 2026-10-17)

**Verdict: APPROVED, 0 CRITICAL / 0 HIGH / 0 MEDIUM / 3 LOW.** None of the LOWs block; fold them or file them as you see fit.

Reviewed PR #40 at `b42a120` (matches the worktree HEAD), against audit H13, the Linear comments and the handoff. Ran the
4 touched files: 54/54 green.

## Do the tests drive the real failure path? (mutation reasoning)
| Mutation in product code | Killed by |
|---|---|
| `save()` skips `saveKey` when not granted | T3.13 deny (key must be in `storage.local`) |
| `granted` forced true / message branch dropped | T3.13 deny + throw (`findByText(NOT_GRANTED)`) |
| `requestProviderPermission` loses its try/catch | T3.13 throw (Save shows Chrome's error instead of NOT_GRANTED) |
| key written to `sync` | `storage.sync.set` not called |
| `contains` short-circuit removed (always `request`) | "not asked again" (the `request` spy; the stub's `has()` alone would hide it) |
| `test()` bails out when not granted | T3.13 Test-denied ("answered. (Browser access…)") |
| `hasGpu` ignores the adapter (`!!gpu`) | T3.11 no-adapter (a worker gets created) |
| `hasGpu` loses its try/catch | T3.11 throws ("GPU process crashed" classifies as `other`, not `unsupported`) |
| `gpuStatus` loses its try/catch | T3.17 throws (text never appears) |
| error styling dropped | T3.17 `text-destructive` |
| `gpu?.ok === false` dropped from the Download `disabled` | T3.17, probably, but by timing, not by design (see L1) |

Equivalent mutant, fine: removing `if (!gpu)` in `gpuStatus` still yields the same text through the catch, so "absent"
and "throws" can't be told apart there. The user sees the same thing either way.

## Back-compat, leaks, scope
- Defaults: `held: 'all'` → `contains`/`request` return true for anything, as before. Both are still `vi.fn`, so the
  existing overrides (`scanFailures.test.ts:134,293`, `mobileCapture.test.tsx:129,623,671`) still work. Those tests are
  unedited and pass in the gate.
- No state leaks: `makeChrome` builds a fresh closure (`held` sets, `opts`) on every call. `options.test.tsx` re-stubs
  `chrome` per test and `afterEach` runs `vi.unstubAllGlobals()`. No module-level deny flag exists to reset.
- `stubGpu` saves the own-property descriptor, and the restore puts it back in `finally`. The llmHost cases use `vi.stubGlobal`,
  re-stubbed in every `beforeEach` (line 260).
- Debugger: no code in the diff touches `backgroundScan.ts`, `background.ts`, wxt/playwright config, `phase5.spec.ts`
  or the debugger tests. `debugger` appears only in the handoff and the lens A doc. SPC-44 owns it cleanly.

## LOW
**L1. T3.17's "Download disabled" assertion relies on microtask order.**
`disabled={busy || phase === 'checking' || gpu?.ok === false}` (`LocalGemma.tsx:~193`). The test waits only for the
WebGPU text, then asserts `disabled`. If a render ever shows the GPU text while `phase` is still `checking` (e.g. a
future `client.status` that takes one more tick), the button is disabled because of `checking`. Then deleting
`gpu?.ok === false` survives, and Download is enabled on a GPU-less browser with a green test. Today `client.status`
resolves first, so it is killed, but nothing pins that.
*Fix:* before the `disabled` assert, `await waitFor(() => expect(screen.getByTestId('gemma-status').textContent).toBe('Not downloaded'))`.

**L2. The throw case pins a message that can mislead, and the stub's throw text can't happen for a provider origin.**
`optional_host_permissions: ['<all_urls>']` (`wxt.config.ts:37`), so "Only permissions specified in the manifest may be
requested." can never come back for a BYOK origin. A real throw there is a lost user gesture or a malformed origin. In
both cases the UI says "…Press Test or Save again and choose **Allow**", but Chrome showed no prompt. The new test
pins that wording for the throw path. (Retrying from a fresh click may well work after a lost gesture, so this stays LOW.)
*Fix (test-only PR):* in the T3.13 throw test pass a realistic `error` (e.g. `'This function must be called during a
user gesture'`) and add a comment that the wording is today's, not a spec. Optionally file a product follow-up to tell
"denied" apart from "the request failed" in `requestProviderPermission`.

**L3. In default mode, `held` and `remove` don't reflect what the stub answers.**
With `held: 'all'`, `request(origin)` returns true but `held.origins` stays empty, and `remove` doesn't make `contains` false.
A future test like `installChrome()` → Save → `expect(chrome.permissions.held.origins.has(ORIGIN)).toBe(true)` fails
confusingly. Worse, `remove` → `expect(contains).toBe(false)` can never pass, which invites "fixing" it with a
`mockResolvedValue` that hides the real path.
*Fix:* one line in the `held` JSDoc: "in `'all'` mode `held` stays empty and `remove` is a no-op; pass `held: {}` to
track grants." (The function comment covers `remove`, but the exposed `held` field doesn't.)
