# PE handoff (session pe-1b, 2026-10-15)

Read your brief (`specimen-herdr/worktrees/sprint-log/docs/sprint/briefs/principal-engineer.md`), then this file.
Orchestrator: check ListAgents (it was `specimen-53`). Worktree: `specimen-herdr/worktrees/pe`, branch `pe/sprint-2`.

## State
| Item | Result |
|---|---|
| PR #24 sprint/log → main (doc-only) | r1 0C/0H/2M/6L, folded in 8c9e434, merged e1e8a6e. Sprint 1 closed |
| SPC-22 critique spike, PR #25 | plan approved (7 changes); lens A r1 2M → r2 APPROVED on ed91231. Owner: GO with a redesign → superseded by SPC-24; #25 not merged |
| SPC-24 Council v2 | my architecture note `docs/sprint/reviews/SPC-24-pe-architecture.md` (this worktree); plan approved with 7 changes; **executor spc-24-3e is building** (worktree `worktrees/spc-24`, branched from exec/spc-22) |

## Open thread: SPC-24 PR review (lens A)
Check against `worktrees/spc-24/docs/sprint/handoffs/SPC-24.md` ("PE changes" + "Frozen contract v1, final"):
- **Run host:** in the offscreen document (`councilHost.ts`), never the service worker. No new permission; offscreen
  reason still `WORKERS`.
- **Closed panel:** a closed panel's Port throws on post → the host try/catches each post, and the engine's `emit`
  guards `onTurn`. The test's fake port must throw after disconnect, as Chrome does.
- **Key:** only in the host's memory. T3.32 serializes every host message, the stored record, `council.started` and
  `council.finished`, and finds no fake key.
- **Records:** a separate Dexie DB `specimen-council`, one atomic put plus prune-to-5 per turn end. The
  `interrupted` fix-up is conditional on `updatedAt`. The SW's onStartup/onInstalled mark `running` records
  `interrupted`.
- **SW guard:** `council.halt{at}`, ignored if the run started after `at`. It halts on flag off, a settings
  fingerprint change, a `secrets.*` change or a vault lock.
- **Contract v1:** `rejected{runId|null, error}` is separate from `status`. `council.started` clears the badge.
- **TESTING.md:** T3.25 and T3.26 are ⊘ (replaced by T3.29 and T3.33); T3.28–T3.33 and T3.34 🖐 are new. Run
  `pnpm check-ids --all` yourself.
- **llmHost:** `attachLlmPort` is a pure refactor (the T3.11 tests are unedited: diff them).
- **SPC-22 guarantees still hold:** the cap, Groq pacing (`PROVIDER_TPM` keyed by provider id = preset id `groq`), 3
  retries, the stall timer, the sanitizer on every turn and on the verdict, the flag `=== true`, mock-only tests.
- **Merge:** none before the owner's go (the runtime flag would ship in a CWS build).
Review file: `worktrees/spc-24/docs/sprint/reviews/SPC-24-a-r1.md`. Then comment on Linear and message the executor
and the orchestrator.

## Contracts in force (added this session)
- **Council Port/runtime protocol v1** (SPC-24, frozen): Port `council`.
  - Panel → host: `start`, `stop`, `attach`.
  - Host → panel: `snapshot`, `turn`, `status`, `rejected`.
  - Host → SW: `council.started`, `council.finished`. SW → host: `council.halt{at}`.
- **`ProviderError` has no `retryAfterMs`.** Adding one is a contract change: a plan plus the owner's OK, reading
  the header only, never the body (H5).
- **Earlier contracts** (TESTING ⊘ format, check-ids, site CSP, gitleaks): unchanged; see git history of this file.

## Known limitations carried (not SPC-24's job)
- The sanitizer's camelCase gap (H3) belongs to SPC-17.
- The WebLLM abort/disconnect bugs (H1, H2) belong to SPC-18.
- The TPM is keyed by provider, not model.

## Lessons
1. **Probe claims cheaply.** A 3-line tsx probe found the parseKeepChange corruption; reading alone missed it.
2. **Check that a test's fake matches production.** The pacing test used `id: 'groq'`, so I confirmed the real BYOK
   provider gets `preset.id`.
3. **Background work in MV3:** a service worker dies after ~30 s idle, and an offscreen document is the durable
   host. Every listener post to a Port must survive a disconnected peer.
4. **Write architecture decisions before the plan arrives.** It saved a rework round on SPC-24.
