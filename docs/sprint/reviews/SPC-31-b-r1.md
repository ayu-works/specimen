# SPC-31 lens B r1 (fresh reviewer, 2026-10-17)

PR #49 @ 70f9849, plus the executor's uncommitted lens-A M1 fold (`[\p{M}\p{Cf}]`) in the worktree. I probed
`sanitize`/`brandTokens`/`nameHasBrand` with tsx scripts in my scratchpad, against both this branch and
`origin/main`'s `sanitize.ts`. SPC-49 (a cut joins its neighbours) is known and not re-reported.

**Verdict: CHANGES REQUESTED. 0 CRITICAL · 1 HIGH · 1 MEDIUM · 2 LOW.**

## Checks that hold
- **Index map:** removal works on whole code points. Surrogate pairs, emoji, a lone surrogate (`"lone \uD800 Zéntrix"`
  → `"lone \uD800 "`), decomposed accents and ß/ligature edges all came back clean, with no half characters or
  broken UTF-16. A match edge inside an expansion rounds outward by at most one original code point.
- **Callers:** every path goes through `sanitize`/`createStreamSanitizer` (prompt, fixPrompt, designmd, the
  `collect.safe` used by council `critique`, `vibe`, `polishPrompt`) or through `brandTokens` + `nameHasBrand`/
  `containsBrand` (designmd variables, fonts). They all share one skeleton.
- **Fail-closed:** no new try/catch, and `normalize` can't throw here. The SPC-32 behaviour is kept.
- **Cost:** linear in the line, with one rebuild per pattern that cut. Measured: a 5.2 MB single accented line takes
  ~600 ms, 2M combining marks after a brand ~110 ms, and 300k short matches ~45 ms. Real lines are far smaller.
  The title windows are still cut before folding. `capPhrases` folds the whole title, which is linear and fine.
- **Over-redaction on the Latin path:** hex, units (`16px`, `1rem`, `100vw`), `box-shadow` and `Café` prose are
  unchanged.
- **Tests:** the core and council tests drive the real paths, and the council one fails on the old code.

## HIGH

### H1. Symbol compatibility folds glue letters onto the brand: `Zentrix™` stops being a brand (a regression from main)
NFKD turns several non-letter symbols into letters: `™`→`TM`, `℠`→`SM`, `℡`→`TEL`, `№`→`No`, `㎒`→`MHz`, and
the Roman numeral `Ⅱ`→`II`. On main these symbols are a word boundary. On this branch they become letters glued
to the brand, so both sides break:
- **Brand side:** the title `"Zentrix™ | Design"` gives the tokens `['zentrixtm', 'example']`. Main gives
  `['example', 'zentrix']`. So `sanitize("use Zentrix here")` returns **`"use Zentrix here"`** (main: `"use here"`),
  and `"use ZENTRIX here é"` also leaks. In DESIGN.md, `--zentrix-blue` with that title is no longer dropped by
  `nameHasBrand`, because `'zentrixtm'` isn't in it. A ™/℠ in a title is common in brand marketing copy, and this
  is a direct leak into prompts, DESIGN.md and council output.
- **Text side:** with the title `"Zentrix"`, `"ZENTRIX™ rocks"` comes back unchanged (main: `"™ rocks"`). The same
  happens for `ZENTRIX℠`, `ZENTRIX㎒` and `ZENTRIXⅡ`. The skeleton is `ZENTRIXTM`, which has no word, camel or
  acronym boundary. This hits every all-caps (or all-lowercase + caps symbol) spelling. It also affects ASCII lines
  that contain one of these symbols, since they all take the fold path.

**Fix:** fold only the code points where folding is wanted. In `foldChar`, return `c` unchanged unless it is a letter,
a mark, a decimal digit or a space (`/[\p{L}\p{M}\p{Nd}\p{Zs}]/u`), and keep dropping `\p{Cf}`. A symbol (`\p{S}`) or
a letter-like number (`Nl`/`No`) then stays a boundary, exactly as on main, while ß, İ, accents, fullwidth
letters/digits, ligatures (`ﬁ` is `Ll`) and NBSP still fold.
**Tests** (each fails today): title `"Zentrix™ | Design"` → `brandTokens` contains `zentrix`, and `"use Zentrix
here"` → `"use here"`. With the title `"Zentrix"`, `"ZENTRIX™ rocks"`, `"ZENTRIX℠ x"`, `"ZENTRIXⅡ x"` and
`"ZENTRIX㎒ x"` all lose the brand. A DESIGN.md with the title `"Zentrix™"` drops `--zentrix-blue`.

## MEDIUM

### M1. Script-specific vowel signs are stripped: different Indic/Thai words collapse into the brand (over-redaction)
`\p{M}` also covers the vowel signs (matras) of Brahmic scripts, which are spelling, not diacritics. The title
`"टाटा मोटर्स"` folds to the phrase `"टट मटरस"`. Then `sanitize("टिटि मिटर्स टाटा")` returns `" टाटा"`: two
*different* words were removed as the brand. The real brand word `टाटा` survives, because its skeleton `टट` is
under 3 characters. That last part isn't a regression: main never tokenised Devanagari at all. The over-redaction
of unrelated words is new, and it hits any page in Hindi, Bengali, Tamil, Thai and similar scripts, whose
headlines and samples become phrases.

**Fix:** drop only the generic combining diacritics: marks with `\p{Script=Inherited}` (U+0300–036F, plus Arabic
harakat, which are Inherited and optional anyway). Keep script-specific marks (Devanagari `ा`/`ि`, Thai vowels)
in the skeleton at width 1. If Indic brands should be tokenised too, treat `\p{M}` as a word character in
`words`/`isWordChar`/`BOUND_*`. That's a separate ticket if the PE prefers.
**Test:** the title `"टाटा मोटर्स"`; prose `"टिटि मिटर्स"` is byte-identical.

## LOW

### L1. The trailing width-0 sweep now also eats bidi controls and joiners after a cut (from the lens-A M1 fold)
With `\p{Cf}` at width 0, `stripFolded`'s "marks after the cut belong to it" loop also removes format characters
after the brand: `"‮Zentrix‬ tail"` → `"‮ tail"`. The PDF that closed the override is gone, so the
rest of the line renders reversed. `Zentrix‍👩` also loses its ZWJ (harmless). This isn't a leak, but it is
visible corruption.
**Fix:** run the trailing sweep only over `\p{M}`, not `\p{Cf}`. Format characters *inside* the `first..last`
range still go with the cut. **Test:** the RLO/PDF case keeps `‬`.

### L2. No test for a symbol or numeral next to a brand on the fold path
The suite covers letters (accents, ß, İ, fullwidth, ﬁ) but no non-letter that NFKD expands, which is how H1 got
through. Add the H1 tests and one with `…`/`½` next to a brand (these pass today) as a guard.

## Note
While probing, I created a probe file in this worktree for under a second
(`packages/core/src/generate/.old_sanitize_probe.ts`) and deleted it straight away. `git status` showed no trace.
All other probes ran from my scratchpad.
