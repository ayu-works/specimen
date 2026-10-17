# SPC-36 lens B review, round 1 (PR #51, commit c4cf3fb)

Reviewer: fresh lens B, read-only. Scope: `cell()` in `packages/core/src/generate/common.ts`, `packages/core/test/tableCell.test.ts`,
the three devDependencies and the lockfile.

**Summary: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 3 LOW.** The new escaping is the right shape: every renderer I checked keeps
each cell in one column. But the stated reason ("GFM's row scanner pairs a backslash", "cmark-gfm's too") is wrong for
GitHub. On GitHub the old code never split a cell, and code cells were exact. Under the new code they show the
backslash run doubled. The decision may still be right, but it was made on a wrong premise and should be re-confirmed.

## What I measured

**GitHub's real renderer** (`gh api -X POST /markdown`, `mode: gfm`, which is cmark-gfm). The input was synthetic probe
strings only, no page data. Each probe went through the old and new `cell()` (copied verbatim), as a plain cell and as
`cell(code(p))`. Every row had 4 columns in **both** old and new. Visible text:

```
probe     OLD plain  OLD code     NEW plain  NEW code
a\|b      a|b  ✗     a\|b   ✓     a\|b  ✓    a\\|b    ✗ (doubled)
a\\|b     a\|b ✗     a\\|b  ✓     a\\|b ✓    a\\\\|b  ✗
a\\\|b    a\|b ✗     a\\\|b ✓     ✓          a\\\\\\|b ✗
\|a       |a   ✗     \|a    ✓     ✓          \\|a     ✗
a|\|b\    a||b\ ✗    ✓            ✓          a|\\|b\  ✗
a|, a\, \2014, "| lead", "trail |"   ✓ everywhere, old and new
a\\       a\ ✗ (old and new; no pipe, so cell() leaves it alone, and it was never a split)
```

**Tests vs. the old code:** I copied `packages/core` to a scratch directory and ran it against `main`'s `common.ts`.
3 of the 4 new tests fail (the 3 probe tests) and the fixture column-count test passes. With the PR's `common.ts`,
all 4 pass. The tests use the real micromark tokenizer. ✓

**Callers:** `cell()` runs only through `table()`. `table()` feeds DESIGN.md and `prompt/sections.ts`, whose prompt
tables hold roles, hex values and numbers, so they have no backslashes and don't change. The token generators (cssvars,
tailwind, dtcg, figma, shadcn) don't use `cell()`. ✓

**Supply chain:** the 3 direct deps are exact-pinned and only in `packages/core` devDependencies. The lockfile diff is
additions only: the importer block plus 42 packages, all from the unified ecosystem (micromark, syntax-tree,
wooorm/`@types`). Every package's lockfile integrity matches the npm registry (all 42 checked), and none has an install
script. Nothing under `src/` imports them; only `test/tableCell.test.ts` does. `apps/extension/.output` (built 21:33)
has no `micromark`/`mdast` strings. ✓ Performance: the `(\\*)\|` regex is quadratic on a long backslash run with no
pipe, but strings are capped at ≤ 4000 characters (`BOUNDS`), so 1000 backslashes take under 1 ms. Not a finding.

## MEDIUM

### M1. The fix rests on "cmark-gfm pairs backslashes", which is false. On GitHub it is a regression for code cells
- **Where:** the `cell()` doc comment (`common.ts:271-278`), the handoff Plan ("cmark-gfm's row scanner consume[s] a
  backslash and the next character as a pair"), and the "Parser drift" note.
- **Failure scenario:** a site has `--sep: a\|b` (or any custom property value with `\` right before `|`). DESIGN.md
  viewed on GitHub showed the code cell as `a\|b` (exact) before this PR, and shows `a\\|b` after it. An agent or a
  human copying from the rendered page now gets an extra backslash, which the old code didn't add. GitHub's table
  scanner treats `\|` as an escaped pipe no matter how many backslashes come before it, and then strips one `\`. It does
  not pair backslashes. markdown-it (the VS Code preview), from my reading of its `escapedSplit`, works the same way;
  I did not run it. Only micromark (remark, MDX, Docusaurus) pairs backslashes and so split the old output.
- **Why it's still MEDIUM, not HIGH:** the new form (an odd run before every pipe) is the only one that is
  unambiguous in **both** scanner families. Plain cells become exact on GitHub too (before, they lost a backslash:
  `a\|b` → `a|b`). And values with `\` before `|` are very rare in real CSS. But the trade-off is different from the
  one PE approved: on GitHub, code cells go from exact to doubled.
- **Fix:** (a) correct the `cell()` comment and the handoff: micromark pairs and splits; cmark-gfm (GitHub) and
  markdown-it never split but strip one `\`; the new form gives one cell in both, and exact plain text in both, at the
  cost of a doubled run in code cells everywhere. (b) Send PE the GitHub table above to re-confirm option 1. The option
  that fixes it: when a value has `\` before `|`, emit that cell as plain escaped text instead of a code span. Plain
  text reads back exactly in GitHub and micromark alike (rows above). PE rejected this because the rule would be split
  across `code()` and `cell()`, but it is the only lossless choice. (c) Optionally add one GitHub-semantics assertion,
  a small helper that splits on any `\|`, so the test doesn't encode only micromark's view.

## LOW

### L1. Raw-markdown readers (agents) see an escaped form, not the value
- **Scenario:** an agent reads DESIGN.md raw and copies `` `a\\\|b` `` for a value that is really `a\|b`. Before
  this PR it saw `` `a\\|b` ``, so both versions are wrong in a different way. The same is already true for every
  plain `|` (`a\|b` raw for `a|b`), so this isn't new. But nothing tells the agent that table cells are escaped.
- **Fix:** a one-line note under the CSS-variables heading in DESIGN.md ("values inside tables have `|` escaped as
  `\|`; the raw value is in `tokens`/`variables.css`"), or point to the token file as the copy source. Can be a
  follow-up ticket.

### L2. A transitive dependency is exactly at the 14-day age line
- `mdast-util-to-markdown@2.2.0` was published 2026-10-03 16:05 UTC and locked about 14 days and 2 minutes later.
  The handoff skipped `mdast-util-from-markdown@2.1.0` for being "exactly 14 days old", but transitive versions
  weren't held to the same rule. It comes in through `mdast-util-gfm-table`'s to-markdown side, which the tests don't
  use. `micromark@4.0.3` and the new `micromark-util-edit-map@1.0.0` (first and only version) are 3 weeks old. All are
  by the real maintainers, and the integrities match.
- **Fix:** none needed for this PR. If the 14-day rule is policy, enforce it with pnpm's `minimumReleaseAge` in
  `pnpm-workspace.yaml` (a separate ticket) rather than checking by hand. Also correct the handoff's "All are 2023 v2
  releases": `micromark-extension-gfm-table@2.1.2` is from 2026-09-11.

### L3. Out of scope, pre-existing: plain-text cells render markdown from page-derived text
- **Scenario:** the Typography "Family" column (`fontPhrase(f)`) is a plain cell. A font family named `*Fancy*`,
  `[x](https://…)` or `<b>x</b>` renders as emphasis, a link or HTML on GitHub (measured: `[l](u)` → link, `*x*` →
  `<em>`), and `a\\` shows as `a\`. Not caused by this PR, and `cell()` was never meant to escape inline markdown.
- **Fix:** a follow-up ticket: put page-derived names in `code()`, or escape ASCII punctuation in plain cells (which
  would interact with M1's plain-text option).

## Not findings (checked)
- Newlines, `\r`, U+2028/2029 → a space before the row is built (SPC-32), so no row breaks. Backticks are dropped by
  `code()`. A leading or trailing `|` and a `|` at the very end (`a|`) render as one cell with the same text. Long
  values are bounded, and the table doesn't break.
- Idempotency: `table()` calls `cell()` once per value, and no caller escapes first.
