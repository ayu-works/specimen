# SPC-31 lens A r1 (PE pe-b2, 2026-10-17)

PR #49 @ 70f9849, base main: `sanitize.ts` (`foldText`/`foldChar`, a folded brand side, `stripFolded` index-map
removal), `test/sanitizeFold.test.ts`, `councilBrandFold.test.ts`, and the TESTING.md rows. core sanitize tests: 26 pass + 1
expected fail (the SPC-49 `it.fails`).

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 1 MEDIUM · 0 LOW.** Fold M1 (one line plus a test). No re-review needed
beyond a glance.

## Checks
- **One skeleton on both sides:** host, title windows (cut on the original, then folded, so the size bound holds),
  phrases, stop words, `wordRegexes` (the cache key is built from the folded list), `containsBrand`, `nameHasBrand`. The
  tests run both directions (accented title vs plain text and the reverse).
- **The removal map is right:** `matchAll` on the skeleton gives the same non-overlapping matches as `replace`, in the
  same pattern order, and `build()` after each pattern that cut keeps the "a later pattern sees earlier cuts" behaviour.
  The range `first..last` covers whole code points (a `ß` at an edge goes whole), zero-width marks inside the range go,
  and trailing marks follow their letter. Surrogate pairs are safe because `[...line]` works in code points.
- **ASCII is byte-identical:** the `NON_ASCII` test sends ASCII lines through the old loop unchanged (tested).
- **Final host check:** runs on `foldText(result)`. The host stays ASCII (punycode), and an IDN title is caught on
  the phrase path (tested).
- **Plan notes:** fullwidth and ligature forms are tested. The re-forming gap ("ZenZENTRIXtrix") was shown to exist
  on the ASCII path too, so it's pinned as `it.fails`, filed as SPC-49, and flips when fixed. Host-cut shapes pass.
  Homoglyphs are stated as out of scope.
- **Bounds:** the fold cache is capped at 4096, the perf test (10 KB line, 30k title) is < 150 ms, and SPC-32's tests are unchanged.
- **Fail closed:** no new try/catch.

## MEDIUM
### M1. Invisible format characters still split a brand
Probed on 70f9849, with the title "Zentrix": `sanitize("by Zen​trix today")`, and the same with U+00AD (soft hyphen) and
U+2060 (word joiner), all come back with the brand intact. Those characters are `\p{Cf}`, not `\p{M}`, so `foldChar`
keeps them at width 1 and the skeleton is `Zen?trix`. Soft hyphens are real in page titles and text (hyphenated
CMS copy), and a model that copies a word from page data carries them into the prompt. A page could also plant
them through prompt injection. The same gap breaks `containsBrand` for CSS variable names.
**Fix:** in `foldChar`, drop default-ignorable format characters as well, e.g.
`c.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '')`, or `\p{Default_Ignorable_Code_Point}` if the runtime supports it.
They then get width 0 like marks: they're skipped in the skeleton and removed with the brand when they sit inside a cut.
Check that a ZWJ emoji sequence *next to* a brand isn't broken (only width-0 code points directly after the cut
go). Test: the three probes above, a soft hyphen in the title itself ("Zen­trix" title vs "Zentrix" text),
and `containsBrand('--zen​trix-blue')`.
