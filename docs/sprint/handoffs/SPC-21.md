# SPC-21: stubs that can say "no" (audit H10, H13)

Executor `spc-21-6e` · branch `exec/spc-21` (from origin/main b01ea77) · PE `pe-b2` (was pe-4d) · orchestrator `specimen-75`.
Status: **built, gate green, PR open.** Plan approved by pe-4d on 2026-10-17. Scope was cut by pe-b2 on 2026-10-17 (below).

## Scope change (pe-b2, 2026-10-17): the debugger half moves to SPC-44
While planning, I found that on Chromium 156 the production build can't request `debugger`. `chrome.permissions.request
({permissions:['debugger']})` from a real click rejects with *"Only permissions specified in the manifest may be
requested."*, because `debugger` can't be an optional permission. specimen-75 filed this as **SPC-44**. The owner chose
option B: remove `debugger` and both CDP paths (`withColorSchemeEmulation`, `scan.run` `emulate`, and mobile "Capture
with permission"). SPC-44 is built stacked on this PR. So this PR **drops** everything SPC-44 deletes:
- The `backgroundScan.ts` fix (attach inside the try, detach only what we attached): the function is going away.
- The colour-scheme and `runMediaCapture` debugger tests.
- The no-debugger e2e flavour (`SPECIMEN_E2E_GRANTS`, Playwright projects, `extensionDir`, the extra build, `.gitignore`)
  and its SPC-44 canary. Once SPC-44 lands, the default e2e build has no debugger.
- The T5.03 e2e rewrite. SPC-44 rewrites T5.03.
**Audit H10, and H13's debugger part, are handled by SPC-44**: with no debugger at all, there is nothing to deny. This PR
touches only test files, TESTING.md and this handoff.

## What shipped
### Shared chrome stub that can deny (`apps/extension/test/helpers/chrome.ts`)
Deny is opt-in. With no options, everything is held and every request is granted, exactly as before; no existing test
changed.
```ts
installChrome({ permissions: { held?: 'all' | { origins?, permissions? }, answer?: 'grant' | 'deny' | 'throw', error? } })
```
- `contains` is true only when every queried origin (an exact match, or a held `<all_urls>`) and permission is held.
  Real Chrome also matches patterns, which the stub doesn't; the code says so in a comment.
- `request`: already held → `true`. `grant` adds it. `deny` → `false`. `throw` rejects (default message
  `NOT_IN_MANIFEST`, Chrome's real text). `remove` takes a grant back. `held` is exposed for assertions. All are `vi.fn`.
- `test/chromeStub.test.ts` pins the default plus each mode.

### GPU helper (`apps/extension/test/helpers/gpu.ts`)
`stubGpu('present' | 'absent' | 'no-adapter' | 'throws')` returns a restore function. Opt-in.

### Tests
| ID | File | Drives |
|---|---|---|
| T3.13 | `test/options.test.tsx` | Save with host access denied: "…did not grant access…", the key is in `storage.local` (never `sync`), the provider is saved. The request throwing gives the same message. Test with access denied still works and says access wasn't granted. A held origin isn't asked again |
| T3.17 | `test/localGemma.test.tsx` | `navigator.gpu` absent, no adapter, or throwing: each shows its message, the line is styled as an error, Download is disabled, and `load` is never called. TESTING.md row moved 🖐 → C |
| T3.11 | `test/ai/llmHost.test.ts` | `requestAdapter` null or throwing: `load` → `kind:'unsupported'`, `status.gpu:false`, no worker created (the missing-`navigator.gpu` case was already covered) |

No product bug turned up in these paths. `requestProviderPermission`, `Byok.save/test`, `gpuStatus` and `hasGpu` all degrade
as intended.

## Failure modes covered
- **Back-compat:** the stub defaults are pinned by a self-test, and every existing test passes unedited.
- **Cleanup:** `stubGpu` restores the previous `navigator.gpu` in `finally`.
- **Drift:** the stub's "throw" message matches Chrome's real text (probed on 156.0.8078.4).

## Next / how to resume
- Lens A r1 (pe-b2): APPROVED, L1 (debugger wording in the stub) folded in a follow-up commit. Waiting for lens B.
- SPC-44 builds on this branch and can use `installChrome({permissions:…})` for its own refusal tests.
