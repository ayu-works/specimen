# SPC-24 review, lens A + contract, round 2 (also verifies the lens-B folds)

Reviewer: pe-99 (PE). PR #26, head `3c3faaa`. 2026-10-15. At the orchestrator's request, this round also checks the
lens-B fixes, in place of a separate lens-B round 2.
**Verdict: APPROVED. 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW.** One condition: CI `gate` must be green on `3c3faaa`. It
was pending when I checked; the executor reports `pnpm gate` green locally. No merge before the owner's go (T3.34).

## Round-1 findings: verified
- **A-M1 / B-M1 / B-L2 (a start racing a stop, halt or settings change): fixed.**
  - `councilHost.ts` keeps three new pieces of state:
    - `pending`: cancelled by a `stop{runId}` for it, or by a `halt(at)` with `resolvedAt <= at`;
    - `lastHaltAt`: kept even when no run is live, and a start with `resolvedAt <= lastHaltAt` gets `rejected{changed}`;
    - `live.resolvedAt`.
  - Halts now compare against `resolvedAt`, not `startedAt`.
  - A cancelled start aborts before `runCritique`, so the result is a `stopped` record with 0 calls.
  - A second start during the provider build gets `rejected{busy}`. The old re-check of `live` after the await is safely
    gone, because `pending` serializes starts.
  - On the panel side, `startCouncil` stamps `resolvedAt` *before* re-reading the flag and the spec after `ensure`. So any
    change committed before the stamp is caught by that read, and any change after it reaches the existing document as a
    halt with `at >= resolvedAt`.
  - A write that commits just before the stamp but is noticed by the SW just after it gives a false-positive halt only.
    That's safe.
  - Tests: T3.31 covers a deferred `makeProvider` × {stop, a halt after, a halt before} (0 calls / 7 calls), the
    `lastHaltAt` rejection, and both halt orders. T3.33 covers a settings change during ensure: nothing is sent.
  - Stop isn't offered in the UI while starting (the button is disabled), so a Stop pressed before the Port opens can't
    happen.
- **A-C1: done.** "Frozen contract v1, final" in the handoff carries all three amendments: `start.resolvedAt`,
  `status.summaryText?` and the `snapshot.record` semantics. They're marked owner OK 2026-10-15 and match the code
  (`parsePanelMsg` requires `resolvedAt` to be a finite number).
- **A-L1 / B-L1: fixed.** On `council.finished`, the guard reads `council.seen` before setting ✓. Tested.
- **A-L2: fixed.** `SESSION_KEY` is exported from `aiSettings.ts` and used by the guard.
- **B-H1: fixed.** When the panel knows the host is gone (Port lost, no offscreen document, or an alive host that
  doesn't know the run), `interrupt(rec, true)` re-reads the stored record and does the conditional write against
  *its* `updatedAt`. A timeout (`gone = false`) stays conditional on the panel's copy only, so a slow but live host is
  never overwritten, and a late `running` snapshot is adopted. The test stores two turns (the stored `updatedAt` moves
  past the panel's copy), then disconnects the host ends. The panel shows interrupted, the DB says `interrupted`, Start
  again is offered, and the mascot goes idle.
- **B-M2: fixed** within the owner-approved snapshot semantics.
  - The host keeps `lastFinished` in memory, cleared on the next accepted run. `attach` serves it.
  - The panel adopts a finished snapshot only over its own copy of the same run, and stores it with
    `saveIfStillRunning`: one `rw` transaction that writes only over a `running` copy.
  - Tested on both the host and the panel.
- **B-M3: fixed.**
  - When the flag goes off, the SW halts the run, clears `specimen-council` and `council.seen`, and clears the badge.
  - A late `council.finished` with the flag off clears again, which catches the halted run's final put.
  - The privacy line is updated. Tested.
- **B-M4: fixed.** There is one long-lived Port per panel, and `council.started` makes a panel without a Port attach.
  Tested with a run started from "another window".
- **B-L3: fixed** (a late snapshot wins). **B-L5: fixed** (the note's wording).
- **B-L4: deferred** to a follow-up ticket (Inspect's `onConnect` hardening is outside lane C). There's a comment in
  `councilProtocol.ts`, and it's listed under Known limitations. Fine: today no other listener reads `council` messages.

## Re-checked, unchanged
- The key is still only in `start` and the run closure. `lastFinished` is the record, which holds no key. The new
  `rejected` texts are fixed.
- There is no new permission, no static `content_scripts`, no `DesignScan` change and no `site/` change.
