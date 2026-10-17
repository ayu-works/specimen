# SPC-36: a backslash before `|` in a DESIGN.md table cell

## Plan (2026-10-17, APPROVED by pe-b2: three micromark/mdast devDeps, pinned)

**Where:** the ticket says `designmd.ts cell()`; the helper is `cell()` in
`packages/core/src/generate/common.ts:272`, used only by `table()` (every DESIGN.md table goes through it).
It turns `|` into `\|` and leaves backslashes alone, so a value `a\|b` comes out as `a\\|b`.

**Question:** in GFM, does `\\|` split the cell? (My guess at plan time, that cmark-gfm pairs backslashes like
micromark, was **wrong**: see Lens B r1. Only micromark pairs and splits.)

### Measurement first
- **Parser:** `mdast-util-from-markdown` + `micromark-extension-gfm-table` + `mdast-util-gfm-table` as
  **devDependencies of `packages/core` only** (the same table tokenizer that remark-gfm uses, without the rest
  of unified/remark; `remark-gfm` itself is fine instead if you prefer). No runtime deps. (Correction: `micromark-extension-gfm-table@2.1.2` is from 2026-09-11.)
- **Input:** real generator output: `generateDesignMd()` on the `landing-basic` fixture with `cssVariables`
  set to the probe values below (the CSS-variable table puts the name and value in `code()` cells), plus
  `table()` directly for plain-text cells.
- **Probes:** `a\|b`, `a\\|b`, `a\\\|b`, `\|` at the start, `a\` at the end of a value, `a|b` (control),
  and a value with no backslash (control).
- **Pass bar (written before running):** for each probe row the parsed table row has **exactly the header's
  column count**, and the probe's cell, read back from the mdast (`inlineCode.value` or text), contains the
  probe value's characters with nothing from the next cell. If every probe passes on today's `cell()`: the ticket
  is verified-not-a-bug, the PR is the test plus a note in this file, and nothing in `src/` changes.
  If any probe gives the wrong column count or its text moves to another cell, it's a bug → fix below.

### Fix (only if the measurement fails)
- In `cell()`, escape a run of backslashes that sits right before a `|` so that the pipe is always preceded by
  an odd number of backslashes: `(\\*)\|` → each backslash doubled, then `\|`. Backslashes not followed
  by a pipe are left alone (so normal values like `\2014` in CSS `content` don't change).
- **"No visible change":** the test reads the value back from the parsed mdast and checks it equals the
  input, both in plain text and inside a code span. Inside a code span backslash escapes normally don't apply;
  GFM strips only the table's `\|` before inline parsing. If it turns out a code span can't carry `a\|b` exactly
  with any escaping, I stop and come back to you with the measured output rather than pick a lossy form.
- No change to `code()`, `sanitize.ts` (SPC-31) or `packages/ai` (SPC-41).

### Tests (`packages/core/test/tableCell.test.ts`, IDs under T2.05)
- `T2.05 a backslash before | never splits a DESIGN.md table cell (SPC-36)`: the probes above through
  `generateDesignMd` and `table()`, parsed with the GFM parser, asserting column count and round-trip value.
- The existing T2.05 well-formedness test is unchanged. Add the SPC-36 clause to the T2.05 row in
  `docs/TESTING.md`.
- If not a bug, this same test is the proof, and stays as a regression guard.

### Failure modes
- **Drift between two copies of a fact:** the escaping lives only in `cell()`; `code()` keeps its own
  backtick/line-break rule. The test exercises them together (a code span inside a cell), which is how
  output is built.
- **Idempotency:** `cell()` runs once per value in `table()`; nothing calls it twice. A test asserts
  `table()` output of an already escaped looking value (`a\\\|b`) still round-trips to itself.
- **Partial output / atomicity / concurrency / cleanup:** n/a (pure string function, no I/O).
- **Parser drift:** GitHub renders with cmark-gfm, which can't run here. Lens B measured it via GitHub's API: it
  never splits on `\|` and strips one `\`. The tests now run under micromark and a model of those rules.
- **Snapshots:** no fixture contains a backslash before a pipe, so existing snapshots shouldn't move. If one
  does, that's a visible change and I stop.

### Check
`pnpm gate` (CI red from the SPC-41 gitleaks hit isn't mine).

## Measured (2026-10-17, today's `cell()`, micromark-extension-gfm-table 2.1.2)
Devs pinned: mdast-util-from-markdown 2.0.3 (2.1.0 is exactly 14 days old, so skipped), micromark-extension-gfm-table
2.1.2, mdast-util-gfm-table 2.0.0. Test: `packages/core/test/tableCell.test.ts`. Rows are `[cells…]` read back from mdast.

**Result: it's a bug.** An odd run of backslashes before `|` splits the cell (plain text and code alike):

Raw values (no JSON escaping); `→` shows the cells read back, `✗` = wrong column count:
```
probe     plain-text cell                 code cell (= DESIGN.md CSS variable row)
a\|b      [a\] [b] [next]  ✗              [`a\] [b`] [next]  ✗
a\\|b     [a\|b] [next]  (loses one \)    [a\\|b] [next]  ok
a\\\|b    [a\\] [b] [next]  ✗             [`a\\] [b`] [next]  ✗
\|a       [\] [a] [next]  ✗               [`\] [a`] [next]  ✗
a\        [a\] [next]  ok                 ok
a\\       [a\] [next]  (loses one \)      ok
a|b       ok                              ok
plain     ok                              ok
```

Escaping variants of `a\|b` inside a code span (source cell → read back):
- `` `a\\\|b` `` → `a\\|b` (2 cols, **one extra backslash**)
- `` `a\\\\|b` `` → splits; `` `a\\|b` `` → splits (today's output)
- `` `a\|b` `` → `a|b` (the table step strips only the backslash right before `|`; code spans don't process escapes)
- plain text `a\\\|b` → `a\|b` ✓ exact

So no escaping round-trips `a\|b` inside a code span. Stopped and sent this to pe-b2 (as planned) for the choice of form.

## Decision (pe-b2, 2026-10-17)
Option (1): in `cell()`, double a backslash run directly before `|`, then escape the pipe. The column count is always
right; plain text reads back exactly; in a code cell the run shows doubled (a known, documented limitation: no form
round-trips there). Rejected: dropping the run (loses characters); keeping such values out of code (rule split
across `code()` and `cell()`); HTML `<code>` + `&#124;` (DESIGN.md is read raw by agents).

## Done
- `cell()` fix + comment with the measured rows (`packages/core/src/generate/common.ts`).
- `packages/core/test/tableCell.test.ts` (T2.05): plain-text exact round-trip, code-cell doubled form, the CSS
  variable table in `generateDesignMd`, and every DESIGN.md table row on 3 fixtures has the header's column count.
  All 3 probe tests failed on the old `cell()`.
- devDeps pinned exactly in `packages/core` only. Build: 29620131 → 29620151 bytes (+20, the `cell()` change).
- T2.05 row in `docs/TESTING.md`. `pnpm gate` green locally (gitleaks not installed locally: skipped; CI scans).

## Lens B r1 (2026-10-17): 1 MEDIUM, 3 LOW
- **M1 (accepted):** my premise was wrong. Measured by lens B on GitHub's renderer (cmark-gfm): it treats `\|` as an
  escaped pipe however many backslashes come before it, then strips one `\`. It never split the old output, and old
  code cells were exact there. Only micromark (remark/MDX/Docusaurus) pairs backslashes and splits. So option 1 gives
  one cell in both, but on GitHub code cells go from exact to doubled. Re-asked pe-b2 (see Next).
- L1 (agents read escaped cells), L3 (plain cells render page-derived markdown): pre-existing, follow-up tickets.
- L2: a transitive (`mdast-util-to-markdown@2.2.0`) is about 14 days old; no change. Corrected: `micromark-extension-gfm-table@2.1.2`
  is from 2026-09-11, not 2023.

## Next / how to resume
- PR #51 open. Lens A r1 (pe-b2): APPROVED, 0 findings (`docs/sprint/reviews/SPC-36-a-r1.md`). Lens B r1 in `docs/sprint/reviews/SPC-36-b-r1.md`. pe-b2 re-ruled M1: KEEP option 1 (the only form that's one cell in both families; plain text exact in both;
  code cell doubled, accepted). Rejected the plain-text fallback (needs its own markdown escaping; rule splits).
  Folded: `cell()` comment corrected; `githubTables()` helper (split on any `|` not after `\`, strip one `\`,
  escapes in plain text, code literal) and every test runs under both parsers. Checked against the old `cell()`:
  the helper reproduces lens B's GitHub "OLD plain" column exactly. pe-b2 fold check on 5ebaba9: APPROVED.
  LOWs: L1/L3 → follow-up SPC-53 (in the PR body), L2 no change.
