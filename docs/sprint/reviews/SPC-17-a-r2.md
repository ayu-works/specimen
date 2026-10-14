# SPC-17 review, lens A + contract, round 2 (the lens-B fold, 79ab376..fc69291)

Reviewer: pe-99 (PE). PR #29, head `fc69291`. 2026-10-15.
**Verdict: APPROVED. 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW.**
- Condition: CI `gate` must be green on `fc69291`; it was pending when I checked.
- The merge note below applies.

- **Contract still matches the owner-approved v4.**
  - B5 drops a *repaired* token whose parsed alpha is 0 (`transparent`) and keeps `alpha = min(stored, parsed)`.
  - A fully transparent value is an unusable color, so this falls within "an unfixable color is dropped, with its
    roles". Valid `#rrggbb` tokens are untouched, so the extractor output test still passes with no repair.
  - Add one line to the handoff's contract text saying that `transparent` counts as unfixable.
- **B3 (validate on write), my r1 follow-up, done here:**
  - `saveScan`, `replaceStoredScan` and `saveCompose` run `DesignScanSchema.parse` before writing.
  - `updateScan` with `variants` validates `{...migrate(row), ...patch}` inside the same `rw` transaction, then writes
    the patch onto the raw row. A v3 row stays v3 on disk and is repaired on read, which is consistent.
  - A bad write now throws at the call site. `scanTab` and `attach` already catch and keep the scan in the session.
  - Unknown keys (`tags`, `favorite`) are stripped by the parse, not rejected.
- **B1/B2/B4 (sanitizer):**
  - Digit humps apply only to tokens of 4+ characters, so CSS units (`100vw`) survive.
  - The `(?<!#[0-9a-fA-F]*)` guard keeps hex-only tokens out of color literals.
  - The acronym and all-caps-before-lowercase humps are covered by failing-first tests.
  - DESIGN.md drops a var whose value references a branded `--name`.
  - `fontInfo` uses `nameHasBrand`.
- **B6** is deferred as SPC-31. That's fine: it predates this PR.

## Merge note (#29 and #30 both touch `apps/extension/src/lib/db.ts`)
The hunks don't overlap: #29 changes `saveScan`, `updateScan`, `replaceStoredScan` and `saveCompose`; #30 adds
`getStoredScan`, `scansForHost`, `latestScan` and the `chatsReady` gate in `loadChat`/`saveChat`. Whichever merges
second rebases and must keep both. Check after the rebase that `db.ts` still has:
- `DesignScanSchema.parse` in the four writers;
- `await chatsReady` in `loadChat` and `saveChat`.

Then run `pnpm gate`.
