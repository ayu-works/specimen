# SPC-36 lens A r1 (PE pe-b2, 2026-10-17)

PR #51, base main: `cell()` in `generate/common.ts`, `test/tableCell.test.ts` (T2.05), three devDependencies, the lockfile, and
TESTING.md. `packages/core`: 98/98 green here.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW.**

## Checks
- **The fix is the one I approved (option 1):** `(\\*)\|` → the run doubled, then `\|`. The pipe is always preceded by an
  odd number of backslashes, so it can't split a row. Backslashes not before a pipe are untouched (CSS `\2014` stays).
  `BREAKS` runs after it and replaces control characters with a space, never deleting them, so it can't create a
  new backslash-pipe pair.
- **Measurement first:** the raw rows are in the handoff, and the tests parse real `generateDesignMd`/`table()` output
  with the GFM table tokenizer: the header column count on every row, an exact round-trip for plain text, and the
  documented doubled run inside a code span. The comment above `cell()` records the trade-off.
- **Dev-only dependencies:** `mdast-util-from-markdown` 2.0.3, `mdast-util-gfm-table` 2.0.0 and
  `micromark-extension-gfm-table` 2.1.2 are exact pins under `packages/core` → `devDependencies`, both in package.json
  and in the lockfile importer. They're imported only by `test/tableCell.test.ts`; nothing under `src/` imports them
  (`common.ts` mentions micromark only in a comment). The extension bundles `@specimen/core` source, so they can't
  reach the bundle. The lockfile adds only their transitive tree (unified/mdast utilities).
- **No snapshot moved:** no fixture has a backslash before a pipe.
