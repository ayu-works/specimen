# SPC-17 review, lens B + contract/data safety, round 1

Reviewer: fresh lens-B reviewer. PR #29 at `79ab376`. Read: setup.md, SPC-17 and all its comments (PE approval, the owner's v4 OK),
failure-path-audit H3/H4/M15/M16, handoff, CLAUDE.md rules, the PR diff. I probed it with tsx scripts against the
branch source and against the merge-base `sanitize.ts`. The scripts are in the reviewer's scratchpad, not in the repo.

**Count: 0 CRITICAL, 2 HIGH, 2 MEDIUM, 3 LOW.**

## HIGH

### B1. The new digit↔letter boundary corrupts hex colors and CSS units (a regression; prompt, DESIGN.md, fixPrompt, council)
`WORD_L` `(?<=\p{N})(?=\p{L})` and `WORD_R` `(?<=\p{L})(?=\p{N})` make a short brand token match inside a hex
literal or a number+unit. Output of `sanitize()`, merge-base compared with this branch:

| host | input | main | this PR |
|---|---|---|---|
| abc.xyz | `The accent #1abc9c` | unchanged | `The accent #19c` |
| ea.com | `link #1ea0ff` | unchanged | `link #10ff` |
| bbc.co.uk | `#2bbc4f` | unchanged | `#24f` |
| ab.com | `#ab12ab` | unchanged | `#12` |
| vw.com | `max-width: 100vw` | unchanged | `max-width: 100` |
| ms.com | `transition 150ms ease` | unchanged | `transition 150 ease` |

Through the real generators, a scan at `abc.xyz`, `ea.com`, `bbc.co.uk`, `ace.com` or `cafe.com` whose accent is
`#1abc9c` / `#1ea0ff` / `#2bbc4f` / `#3ace7d` / `#0cafe0` produces a prompt and a DESIGN.md **without the accent hex**.
`#19c` is a valid 3-digit hex (`#1199cc`), so the agent is given the wrong color with no error. `#1abc9c` is one
of the most common flat-UI turquoises. `packages/ai` `collect.ts` sanitizes page data with the same function, so the
council also sees the corrupted colors. Any token made only of the letters a–f (`abc`, `ace`, `bbc`, `cafe`, `fade`, `bad`, `ea`,
`fb`, `dc`…) or equal to a CSS unit (`vw`, `vh`, `ms`, `em`, `px`, `pt`) is affected, and title words count as tokens too.

**Fix:** (a) never match inside a hex literal: add `(?<!#[0-9a-fA-F]*)` to `WORD_L` (JS allows a variable-length
lookbehind), or mask `#[0-9a-fA-F]{3,8}\b` spans before replacing; (b) use the digit boundaries only for tokens
of ≥ 4 characters (the same threshold PE change 1 uses), so `100vw` and `150ms` survive while `zentrix500` is still
stripped. **Test (T2.03):** the six rows above keep their input unchanged, `generatePrompt`/`generateDesignMd` for
`abc.xyz` + `#1abc9c` still contain `#1abc9c`, and `zentrix500` / `2zentrix` are still stripped.

### B2. DESIGN.md still leaks the brand through CSS-variable **values** and a missing left hump
`designmd.ts:298` applies the new substring rule (`nameHasBrand`) to the **name** only. The value still goes through
`containsBrand`, the word/hump regex. The plan's own motivating case, the all-lowercase `--zentrixblue`, therefore
leaks as soon as it's referenced through an alias. In addition, `WORD_L` lacks the mirror of `WORD_R`'s
`(?<=\p{Lu})(?=\p{Lu}\p{Ll})` (an acronym followed by a capitalised word), so `UIZentrixBlue` / `XMLZentrix` aren't
matched. Probe: `generateDesignMd` on `zentrix.com` with
`{'--color-primary':'var(--zentrixblue)', '--accent':'var(--UIZentrixBlue)', '--x':'var(--ZXZentrix-500)'}`. All three
rows are printed verbatim (`| \`--color-primary\` | \`var(--zentrixblue)\` |`). The final `sanitize()` misses them
for the same reasons, and the host check (`zentrix.com`) doesn't fire. Aliasing a primitive into a semantic var is
the normal design-token pattern, so this is the common real-world shape, not an edge case. It's the ethics guardrail.

**Fix:** in the CSS-var filter, also run `nameHasBrand` on every `--[\w-]+` identifier found in the value
(`v.match(/--[\w-]+/g)`), and add `(?<=\p{Lu})(?=\p{Lu}\p{Ll})` to `WORD_L`. **Test (T2.03):** the three rows above
are dropped, `--space-4: 16px` is kept, and `sanitize('XMLZentrix ZENTRIXapi')` strips the brand.

## MEDIUM

### B3. A v4 row that fails the new refinement silently vanishes from the Library; nothing validates on write
The Library path follows the owner's contract (a broken v4 is rejected), but the rejection happens on **read**:
`db.ts toStored` swallows the error and `listScans` drops the row with no notice. `countScans` still counts it, so
the numbers disagree. None of the writers validates against the stricter schema: `saveScan`, `replaceStoredScan`,
`saveCompose` and especially `updateScan(id, { variants })` (`extras.ts attach`, built from `extract(…, { validate:
false })` via `captureFlow.toVariant`). I traced today's writers (extract, merge, compose, `toVariant`,
`deriveCounterpart`): they all produce valid `#rrggbb` and in-palette roles, so **nothing vanishes today**. But v4
widened the set of rows that can be hidden from "malformed JSON" to "one role id off by a rename". A future bug in
any variant/role writer would make the user's own scans disappear with no error, which is what H4 was meant to
prevent. Example: a later change prefixes variant ids differently from the roles. The scan saves, shows for that
session, and is gone from the Library after a reload.

**Fix (no contract change):** validate before writing. `DesignScanSchema.parse` in `saveScan` /
`replaceStoredScan`, and in `updateScan` when `variants` is patched (parse the merged row). The failure then surfaces
at the action that caused it, inside the existing try/catch and toasts, instead of as a lost scan later. Optionally
show "N saved scans couldn't be read" in the Library when `listScans` skips rows. **Test (T4.01):** `updateScan` with
a variant whose role points nowhere rejects, and the stored row still lists.

### B4. A lowercase-concatenated brand in a **font family** name still leaks (the same class as H3, M16's surface)
`fonts.ts:61` decides `branded` with `containsBrand(family.name, tokens)`. A family named `zentrixsans` /
`Zentrixsans` (no hump, no separator) isn't branded, so `label = family.name` goes into the prompt and DESIGN.md.
`sanitize()` misses it for the same reason, and the host check doesn't fire. This was pre-existing, but SPC-17
introduced `nameHasBrand` for exactly this shape, and M16 is about branded fonts. **Fix:** use `nameHasBrand` (the
≥ 4-char substring) for `branded` and for the stack-part filter at `fonts.ts:62`. **Test (T2.03/M16):** the family
`zentrixsans` gives `branded: true`, and the prompt has no `zentrix`.

## LOW

### B5. Repair turns `transparent` (and other alpha < 1 values) into an opaque color
`repairColors` normalises any parseable value with `alpha: 1` and leaves the token's own `alpha` field as it was.
A hand-edited or imported v3 token `hex: 'transparent'` with role `background` becomes `#000000`, and the
prompt then says "a dark interface on a #000000 background". `rgba(1,2,3,.5)` loses its translucency the same way.
The extractor never wrote these, so only foreign or edited files are affected. **Fix:** drop the token when the
parsed alpha is 0, else set `alpha = min(t.alpha ?? 1, parsed.alpha)`.

### B6. Unicode case gaps in `anyCase` (pre-existing, now visible)
`anyCase` falls back to the literal character when the upper form isn't one code point, so the token `straße` doesn't
match `STRASSE`, and `istanbul` doesn't match `İSTANBUL`. Accent variants (`Zéntrix` against the token `zentrix`) aren't
folded either. This isn't a regression, since `/iu` didn't fold these either. **Fix (optional):** for such characters,
emit `(?:ß|SS)` (lower|full upper), and NFD-strip marks on both the text and the token when testing.

### B7. Test gaps
The new T2.03 cases only cover over-redaction for `Calendar`/`linear-gradient`. Add the B1 table (hex and units)
and the B2 value cases, so the boundary can't regress silently. The repair test has no case for `transparent`
(B5).

## Checked and fine (no action)
- **No v1–v3 scan vanishes because of v4.** Uppercase, 3-digit, 8-digit, `rgb()`/`rgba()` and `oklch()` values
  are normalised (and the oklch recomputed). `currentColor`, `var(--x)` and `''` are dropped together with their
  roles, with a warning. An empty palette works (its roles are dropped). A role-id case mismatch drops only that dead
  role, which the generators already ignored. A dangling variant role is dropped. Rows that throw (`hex: null` or
  missing, `variants.dark.palette: null`, missing `meta.warnings`) **already failed v3** at merge-base, so there's
  no regression.
- **Idempotent and pure:** `migrate(migrate(x))` deep-equals `migrate(x)`, the input is unchanged, and the warning
  doesn't stack. The read path never writes back, so there's no rewrite loop.
- **Import/export:** v3 `.specimen.json` files import repaired. A v4 export of a repaired row carries the warning
  once and re-imports. Uppercase hex in a v4 file is rejected and counted as skipped, as approved.
- **Performance:** 2,000 clean v3 rows migrate in about 66 ms (2,000 v4 rows in about 14 ms). `structuredClone` cost is negligible.
- **Over-redaction from the ≥ 4-char substring rule:** zero CSS variables newly dropped across `fixtures/raw`
  (cal, linear, ramp, stripe; 395 vars). `--php-version` on `hp.com` is kept. Dictionary-word brands (`stripe`,
  `linear`, `space`) drop more rows than before (`--striped-rows`, `--linear-ease`), but dropping a table row is
  acceptable and matches the plan.
- **Council coverage:** `packages/ai` `collect.ts` goes through `sanitize()`, so it inherits the fix. It also
  inherits B1.
