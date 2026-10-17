# SPC-31 handoff: brand sanitizer folds ß, İ and accents

Executor: spc-31-7e · branch `exec/spc-31` (from origin/main b01ea77) · PE: pe-b2 · orchestrator: specimen-5c

## Plan (APPROVED by pe-b2, 2026-10-17)

### Problem
`sanitize.ts` matches brand tokens with per-character `[zZ]` classes and phrases with `/giu`. Neither folds
`ß`↔`ss`, `İ`→`i`, or accents: title "Zéntrix" yields token `zéntrix`, so a model writing "Zentrix" survives (and
"Straße" vs "STRASSE", "ZÉNTRIX" vs "zentrix", decomposed `é` vs precomposed `é`).

### Approach: match on a case-preserving "skeleton", remove from the original
`skeleton(s)` = per code point: NFKD, drop combining marks (`\p{M}`), plus a small full-fold table that NFKD
doesn't cover: `ß`→`ss`, `ẞ`→`SS`, `ς`→`σ`, `ı`→`i`. **Case is kept** (NFKD of `É` is `E`, of `İ` is `I`), which is
the key choice: the existing case-sensitive camel/acronym/digit-hump boundaries, `anyCase`, the hex guard and the
`KEEP_AFTER` rules all keep working unchanged on the skeleton. Case-insensitivity stays where it is today.

1. **Brand side.** `brandTokens`, `isStopWord`, `hostPhrasesOf`, `textPhrasesOf` skeleton their inputs before
   tokenising / lower-casing, so tokens and phrases are already folded (`Zéntrix` → `zentrix`, `Straße` → `strasse`).
   Title windows (`TITLE_SCAN`) are still cut on the original title, so the size bound is unchanged.
2. **Text side.** `sanitizeWith` per line:
   - **Fast path:** if the line has no code point ≥ U+0080 (one `/[^\x00-\x7f]/` test), skeleton = line; the
     current `replace` loop runs exactly as today (byte-identical output, same cost).
   - **Otherwise:** build `sk` (skeleton string) and `src: Int32Array` (skeleton UTF-16 index → original
     code-point start index). Run the same patterns in the same order (sequential semantics kept: a phrase is removed
     before the words inside it, and removals can create new adjacency exactly as today). Each pattern's matches are
     cut out of `sk` and `src` together; the original indices they covered are marked removed. A match edge inside a
     multi-char expansion (`ß`→`ss`) rounds **outward** to the whole original code point, and trailing combining marks
     of a removed char (`e` + U+0301) go with it. Output = original text minus removed code points, then the existing
     double-space / `( ` cleanup. Unmatched text keeps its accents ("Café" in prose stays "Café").
3. **Final host check** compares `skeleton(result).toLowerCase()` with the folded host; the non-dev fallback removes
   it with the same mapped-removal routine.
4. **`containsBrand` / `nameHasBrand`** (DESIGN.md CSS variable names) run on `skeleton(name)`.
5. **Fold cache:** non-ASCII code point → fold, in a `Map` capped at 4096 entries (cleared when full), so `normalize`
   runs once per distinct char, not per occurrence.

### Size bound (SPC-32 freeze)
- Skeleton is linear: one pass per line, ≤ 18 UTF-16 units per code point (worst NFKD expansion, U+FDFA); a typical
  accented char gives 1. Patterns and the compile cache are unchanged in count and size (tokens are ≤ `MAX_TOKEN`
  after folding; a token that grows past 64 by folding is dropped, as today).
- Per pattern with ≥1 match, `sk`/`src` are rebuilt once (O(line)). Same order as today's `replace` per pattern.
- Measured bar (test): the existing SPC-32 perf tests stay green unchanged, plus a new one: a 10 KB line of
  non-ASCII text (accents, ß, İ, CJK) with a 30k-char accented title sanitizes in < the same budget the ASCII test uses.

### Files
- `packages/core/src/generate/sanitize.ts` (only source file).
- `packages/core/test/sanitizeFold.test.ts` (new) · `apps/extension/test/councilBrandFold.test.ts` (new; council
  output through `@specimen/ai`'s `critique` with a stubbed provider; no edit to `packages/ai` or `council.test.tsx`).
- `docs/TESTING.md`: extend the T2.03 row text (Unicode folding) and T3.22 (council); no new IDs.
- This handoff file.

### Tests (written first; all named `T2.03 …`, council one `T3.22 …`)
1. Title "Zéntrix" (accented), model text "Zentrix", "ZENTRIX", "zéntrix", decomposed "Zéntrix", "ZÉNTRIXBlue"
   → brand gone; title "Zentrix" with text "Zéntrix" → gone (both directions).
2. Title "Straße" → "STRASSE", "Strasse", "straße", "STRAẞE" all removed; title "STRASSE" → "Straße" removed.
3. Title "İzmirco" → "Izmirco", "izmirco", "İZMİRCO" removed; dotless "ızmirco" removed.
4. Exact removal: `"Café Zéntrix-blue look"` with brand `zentrix` → `"Café -blue look"` style: neighbours keep their
   accents, no stray combining mark left, nothing extra removed; a ß at a match edge is removed whole.
5. Every generator (`generatePrompt` for all targets, `generateDesignMd`, and the other `generate/index.ts` outputs
   that take text) with an accented/ß title and accented CSS variable names (`--zéntrixBlue`) → no folded brand in
   `skeleton(output).toLowerCase()`.
6. Council: `critique` with a stub provider whose persona and moderator turns say "Zentrix"/"ZÉNTRIX"/"Straße" →
   no brand in any transcript turn or the verdict (T3.22).
7. Stream: `createStreamSanitizer` on accented text ends equal to `sanitize` and every snapshot is folded-clean.
8. Over-redaction (B1 regression, run on the fold path too): title "Café" keeps `#cafe00`/`#CAFE12`; title "Box"
   keeps `box-shadow`; 2–3 letter brands keep `100vw`, `150ms`; prose "Café au lait" with an unrelated brand is
   byte-identical; ASCII-only lines are byte-identical to the pre-change output (fast path).
9. Fail-closed (SPC-32): a thrown pattern error still propagates on the fold path; existing failClosed tests unchanged.
10. Perf: bar above.

### Failure modes
- **Drift between two copies of a fact:** tokens folded but text not (or the reverse) → silent miss. One `skeleton`
  function used on both sides; test 1 checks both directions.
- **Mis-mapped removal** (off-by-one in the index map, surrogate pairs, expansions): would cut a neighbour or leave
  half a brand / an orphan combining mark. Removal works on whole original code points only; test 4 + an emoji
  (surrogate pair) next to a brand.
- **Over-redaction:** folding makes more strings equal (e.g. `ı`→`i`). Only brand tokens/phrases match, still at the
  same boundaries; B1 tests run on the fold path too (test 8).
- **Cost:** see size bound; fast path keeps ASCII cost identical. Fold cache bounded.
- **Fail closed:** no new try/catch; any error still throws to the callers (`safe()` → `''`).
- **Idempotency / caches:** `COMPILED` key is built from the folded phrases/tokens, so it stays content-keyed; the
  stream sanitizer stays per-line, so its cached-line equivalence holds (test 7).
- **Atomicity / partial failure / concurrency / cleanup:** pure synchronous function, no I/O; n/a.

## Done (2026-10-17)
- `sanitize.ts`: `foldText`/`foldChar` (NFKD, marks dropped, ß/ẞ/ς/ı table, bounded cache); brand side
  (host, title windows, phrases, stop words, `wordRegexes`, `containsBrand`, `nameHasBrand`) folded;
  `stripLine` keeps the ASCII loop as is and sends non-ASCII lines to `stripFolded` (skeleton + index map, whole
  code points, marks follow their letter). Final host check runs on the folded result; the host itself stays ASCII.
- Tests: `packages/core/test/sanitizeFold.test.ts` (T2.03: ß/İ/ı/accents/decomposed/fullwidth/ligature, both
  directions; exact removal; B1 hex/units on the fold path; IDN title; containsBrand; every generator; stream; perf
  < 150 ms for a 10 KB accented line with a 30k-char accented title) and `apps/extension/test/councilBrandFold.test.ts`
  (T3.22 council turns and verdict). The council test fails against the old sanitizer (checked).
- PE notes: (a) a cut can join neighbours into the brand ("ZenZENTRIXtrix"): pre-existing on the ASCII path too, so
  pinned as `it.fails` and filed as **SPC-49**; host-cut shapes pass. (b) fullwidth + ligature tests added. (c)
  homoglyphs out of scope, stated in the PR body. (d) host matching stays ASCII; IDN title test added.
- `docs/TESTING.md` T2.03 and T3.22 rows extended. `pnpm gate` green.

- Lens A r1 (pe-b2): APPROVED, 1 MEDIUM folded. M1: `\p{Cf}` format chars (soft hyphen, ZWSP, word joiner, ZWJ)
  now fold to width 0 like marks; tests for text, title, `containsBrand`, and ZWJ emoji next to a brand.

## Next
- Lens B review; fold findings.

## How to resume
Read this file, `packages/core/src/generate/sanitize.ts`, `packages/core/test/sanitizeFold.test.ts`.
