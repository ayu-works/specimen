# SPC-36: a backslash before `|` in a DESIGN.md table cell

## Plan (2026-10-17, APPROVED by pe-b2: three micromark/mdast devDeps, pinned)

**Where:** the ticket says `designmd.ts cell()`; the helper is `cell()` in
`packages/core/src/generate/common.ts:272`, used only by `table()` (every DESIGN.md table goes through it).
It turns `|` into `\|` and leaves backslashes alone, so a value `a\|b` comes out as `a\\|b`.

**Question:** in GFM, does `\\|` split the cell? Both micromark-extension-gfm-table and cmark-gfm's row scanner
consume a backslash and the next character as a pair, so `\\` pairs up and the `|` after it is a real
delimiter. My guess is that it splits, but this is the measurement.

### Measurement first
- **Parser:** `mdast-util-from-markdown` + `micromark-extension-gfm-table` + `mdast-util-gfm-table` as
  **devDependencies of `packages/core` only** (the same table tokenizer that remark-gfm uses, without the rest
  of unified/remark; `remark-gfm` itself is fine instead if you prefer). No runtime deps. All are 2023 v2 releases.
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
- **Parser drift:** GitHub renders with cmark-gfm, which I can't run here without a native dep. Note in the
  PR that the measurement is micromark's; its table scanner treats `\` + char as a pair like cmark-gfm's.
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

## Next / how to resume
- PR open; fold reviews as they arrive in `docs/sprint/reviews/`.
