# SPC-24 review, lens A + contract (protocol v1), round 1

Reviewer: pe-99 (PE). PR #26, head `ce8bc27`. 2026-10-15.
**Verdict: 0 CRITICAL / 0 HIGH / 1 MEDIUM / 1 CONTRACT / 2 LOW.** Fold M1 and C1; the LOWs are cheap and worth doing. I re-review M1 only.

## Checked and fine
- **Run host:** the run lives in `offscreen/councilHost.ts` and is started from `offscreen/main.ts`. There is no new permission, the offscreen reason and justification are unchanged, and there is no static `content_scripts`.
- **Closed panel:**
  - `post()` try/catches and drops the port, and `onDisconnect` drops it too.
  - The engine's `emit` guards `onTurn`.
  - `save()` has a `.catch`.
  - T3.30's fake port throws after disconnect, and `localPort` does the same.
- **Key:**
  - The key travels only in `start` and lives in the run closure. The record, `snapshot`, `status`, `council.started`/`.finished` and `rejected` carry none of it.
  - `rejected` uses fixed texts only. A throwing `makeProvider`, even one that throws the key, maps to `COUNCIL_REJECT.provider`.
  - T3.32 serializes everything the host sends and stores, including a provider error that contains the key.
- **Records:**
  - The DB is separate (`specimen-council` v1), so the main DB is untouched.
  - `putRun` does the put and the prune-to-5 in one `rw` transaction.
  - `markInterrupted` re-reads and checks `status` and `updatedAt` in one transaction.
  - `live = null` is only set after the final put settles. So a `snapshot{null}` for a stored `running` record does mean the final put failed (twice), and `interrupted` is the honest answer.
  - The SW registers `onStartup`/`onInstalled` → `interruptAllRunning` → `!` synchronously inside `defineBackground`.
- **Executor's addition** (await the first put, plus `probe()` when the store shows no running run): sound. `probe` only adopts a `running` snapshot. No contract change.
- **SW guard:**
  - It fires on: the flag `!== true`, a fingerprint change (provider, webllmModel, preset, baseUrl, model; `downloaded` is ignored), any `secrets.*` change, and the vault key removed.
  - Production key names match: `settings.ai`, `secrets.`, `session.vaultKey`.
  - There is no halt when there's no offscreen document.
  - `halt` uses `startedAt <= at`, and both orders are tested.
- **Badge:** cleared on `council.started` and on `council.seen`; ✓ on done; ! on error or interrupted; nothing on stopped.
- **llmHost:** `attachLlmPort` is a pure extraction, and no `llmHost` test file is in the diff (T3.11 unedited). `webllm.ts` disconnects its port, so the in-page pair doesn't leak entries in `ports`.
- **SPC-22 guarantees:**
  - The cap and the persona/round validation are enforced both in `parsePanelMsg` and in the engine.
  - Pacing still uses `provider.id`, and `resolveByokProvider` is the same function, so `groq` is still keyed by the preset id.
  - Retries, the stall timer and the sanitizer are unchanged. `summaryText` is the sanitized summary turn.
  - The flag check is `=== true`.
  - The tests are mock-only, with no network.
- **Engine:**
  - `[Goal]` is outside `<page_data>` and `clipContext` strips control characters.
  - The system prompt has a fixed added rule and no goal text in it.
  - `parseVerdict` returns null without a verdict line, and `"None"` gives an empty list.
- **TESTING.md:**
  - T3.25 and T3.26 are ⊘ in the agreed format, and T3.28–T3.33 and T3.34 🖐 are added.
  - `pnpm check-ids --all` passes (I ran it).
- **CI:** the `gate` check was still pending when I looked. It must be green before merge.

## M1 (MEDIUM): a Stop or a SW halt during `start`'s provider build is lost
`start()` awaits `deps.makeProvider` (councilHost.ts:87) before it sets `live`.
- During that await, `stop{runId}` (line 181) and `halt(at)` (line 190) both see `live === null` and do nothing.
- Then `startedAt = now()` is stamped after the await (line 101), so a halt whose `at` fell inside that window is also ignored by the `startedAt <= at` rule.

**Failure scenario:**
1. The user clicks Start, then turns the Labs flag off, switches the provider away from Groq, or presses Stop at once.
2. `makeProvider` is still resolving. `isChromeBuiltinAvailable` and the WebLLM setup are async, and BYOK is a microtask at least.
3. The halt or stop arrives and is dropped.
4. The run starts and sends the scan plus the goal to the provider the user just left, or keeps running with the flag off.

There is a wider version: if the change lands between `resolveProviderSpec()` in the panel and `offscreen.ensure` creating the document, the SW sends nothing at all, because there is no offscreen document yet.

**Fix (no contract change):**
- (a) Stamp `startedAt = now()` when the `start` message is received, before the await.
- (b) Keep a `pending: { runId, startedAt, cancelled }` while the provider is built:
  - `stop{runId}` for the pending runId sets `cancelled`.
  - `halt(at)` with `pending.startedAt <= at` sets `cancelled`.
  - After the await, a cancelled start stores and broadcasts a `stopped` run with no calls: abort the controller before `runCritique`; the engine already covers "Stop before start" (T3.20). Alternatively, answer `rejected` with a fixed "stopped" text.
- (c) For the pre-document window, the panel re-checks once its own `snapshot` arrives. If `loadFlag('critique') !== true`, or a fresh `resolveProviderSpec()` fingerprint (`kind`, `preset`, `baseUrl`, `model`, `modelId`) differs from what it sent, it sends `stop{runId}`. If you skip (c), name the residual window under Known limitations in the handoff and the PR.

**Tests (T3.31):**
- `makeProvider` is a deferred promise; `stop{runId}` arrives before it resolves → zero provider calls and the run ends `stopped`.
- The same with `halt(at)` where `at >=` receipt time → zero calls.
- `halt(at)` where `at <` receipt time → the run proceeds.

## C1 (CONTRACT): `status` gained `summaryText`, which the frozen v1 doesn't have
Frozen v1 has `status{ runId, status, verdict?, error? }`. `councilProtocol.ts:72` and the host send `summaryText?` too. It's additive and optional, both ends ship in this PR, and v1 has never been released, so I accept it as a **v1 amendment**. It is needed for the raw-text fallback when `verdict` is null.

**Fix:**
- Update "Frozen contract v1, final" in `docs/sprint/handoffs/SPC-24.md` to `status{ runId, status, verdict?, summaryText?, error? }`, noting "(amended in A-r1)".
- `summaryText` is the sanitized moderator text only, and it is covered by T3.32's key scan, which already serializes `status`.

I'm telling the orchestrator about the amendment, as the contract rule requires. Don't add any other field without asking.

## L1 (LOW): a ✓ badge can stick after the open panel already marked the run seen
At the end, the host posts `status` to the panel, then sends `council.finished` to the SW. If the panel is open, it calls `markSeen` → `council.seen` → the SW's `onChanged` clears the badge. That storage event can reach the SW before `council.finished` does, and then the SW sets ✓ for a run the user has already seen. The ✓ stays until the next run starts.

**Fix:** in `onRuntime` for `council.finished`, read `council.seen` from storage first and skip the badge if it equals `msg.runId` (inject `getSeen` into `GuardApi`). Test it in T3.31.

## L2 (LOW): the vault key name is duplicated
`councilGuard.ts:11` hard-codes `'session.vaultKey'`, while `aiSettings.ts:41` has its own private `SESSION_KEY`. If either one is renamed, a vault lock silently stops halting the council, and the guard test, which uses the same literal, would still pass.

**Fix:** export `SESSION_KEY` from `aiSettings.ts` and import it in the guard and its test.
