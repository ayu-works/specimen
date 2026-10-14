# SPC-17 security review r1 (post-merge, PR #29 → main df0297c)

Reviewer: security (fresh). Scope: brand sanitizer (`packages/core/src/generate/sanitize.ts`, its callers in
`designmd.ts`, `fonts.ts`, `packages/ai/src/features/collect.ts`/`critique.ts`), DesignScan v4 validation and
migration (`schema/scan.ts`, `schema/migrations.ts`), import and write paths (`apps/extension/src/lib/libraryIO.ts`,
`db.ts`).

Method: read the diff, then measured worst cases with scratch scripts outside the repo (Node 24 / V8, the same
engine as Chrome) on the real `sanitize.ts`, `migrate()` and `generateDesignMd()`, and on the pre-PR `sanitize.ts`
for comparison.

**Totals: 0 CRITICAL, 1 HIGH, 2 MEDIUM, 3 LOW.** None is a data-exfiltration or key issue. They are all
availability problems or guardrail degradation driven by hostile page input or hostile imports.

## What held up (verified)

- **No catastrophic backtracking.** All regexes run in linear time. Worst inputs tried, each 0–3 ms at 160k chars:
  `'a'×n` and `'#'+'cafe'×n` against the hex-only token `cafe` (the variable-length `(?<!#[0-9a-fA-F]*)`
  lookbehind), `'A'×n` and `'aB'×n/2` against camel/acronym humps, and `'cafe-'×n`. The cost problems below come
  from the *number* and *size* of the compiled patterns, not from backtracking.
- **No prototype pollution.** I imported `cssVariables: {"__proto__": {...}, "constructor": "x"}` and
  `colors.roles: {"__proto__": {...}}` as v3 (repair path: `structuredClone`, spreads, `Object.fromEntries`) and as
  v4. `Object.prototype` was untouched, the output objects kept the normal prototype, and `__proto__` did not
  survive. (`constructor` survives as an ordinary own key; see L2.)
- **Validation runs before any write.** `importFile` migrates every scan before the first `saveScan`, and
  `saveScan`/`replaceStoredScan`/`saveCompose`/`updateScan(variants)` now also parse. Malformed v1–v3 rows were
  rejected or skipped (non-string roles, `variants.dark.roles: 'x'`, palettes holding `null`/numbers,
  `schemaVersion: '3'`, `null`); none of them threw out of `importFile`.
- **20 MB import cap.** A 10 MB `[[[…]]]` nesting parses in ~0.75 s without a crash.
- `safe()` catches sanitize's dev-mode throw. `Generate.tsx` and `FidelityCheck.tsx` wrap generation in
  try/catch, so a throwing generator shows an error message and does not blank the side panel.

---

## HIGH

### H1. A long page title explodes the brand-token set: multi-second freezes in DESIGN.md, prompts and every council delta, and it persists in the library

`brandTokens()` adds every non-stop-word of 3+ chars in `scan.title`, with no cap. Every token then becomes its own
regex, recompiled on **every** `containsBrand`/`nameHasBrand` call (`wordRegex` has no cache) and once per
`sanitize` call. PR #29 made this worse in three ways:

- `designmd.ts` now calls `nameHasBrand` for the name and for every `--ref` inside each value, as well as
  `containsBrand(v)`. That is 3+ calls per variable, each compiling one regex per token, and all variables are
  filtered before `.slice(0, 40)`.
- `anyCase()` roughly doubles the pattern size.
- More boundary alternatives are tried per position.

Measured on the real `generateDesignMd` with the extractor's 200-variable cap:

| Title (words / chars) | `generateDesignMd` |
| --- | --- |
| 100 / 563 | 0.46 s |
| 1,000 / 5,963 | 4.2 s |
| 4,000 / 26,667 | **16.4 s** |

The streaming path (`collect`/`critique` → `safe(raw)` after **every delta**) costs O(deltas × text × tokens):

| Stream | New sanitize | Old sanitize |
| --- | --- | --- |
| 3,000 deltas, ~300 tokens | 6.2 s | 4.2 s |
| 3,000 deltas, ~50 tokens | 0.9 s | 0.5 s |

A single 10 KB `sanitize` with a 3,000-word title takes 3.0 s. A council run makes that call on every delta of
every turn, plus the verdict.

**Scenario.** A hostile (or just SEO-spammy) site sets `document.title` to about 25k characters of distinct words.
The sampler copies `document.title` uncapped (`sampler/index.ts:58`, `extract` passes it through). The user scans,
and the side panel's Generate view freezes for 15 s or more on each render or format switch that recomputes
DESIGN.md. Starting the council pins the CPU of the context running it for minutes. The scan is saved, so
reopening it from the Library freezes the panel again. An imported `.specimen.json` can carry the same title, since
the schema has `title: z.string()` with no maximum.

**Fix (any one helps, all three recommended):**
1. Cap the title at capture and in the schema: `title.slice(0, 300)` in the sampler or `extract`, and
   `z.string().max(1000)` in the v4 schema. Repair longer titles on read by truncating.
2. Cap `brandTokens()` output (for example the SLD pieces plus the first 12 title tokens), and memoize compiled
   regexes per token (a `Map<string, RegExp>`, reset `lastIndex` before `.test`). Better still, build **one**
   alternation regex per scan, `(?:L)(?:tok1|tok2|…)(?:R)`, and cache it on the scan object or in a WeakMap.
3. In `collect`/`critique`, throttle `onText(safe(...))` (for example sanitize at most every 100 ms or on newline)
   and always sanitize the final text. That turns the O(deltas × length) cost into O(length).

Add a test: a scan whose title is 30k chars of distinct words, with `generateDesignMd` and `sanitize` each under a
time budget (for example 200 ms).

---

## MEDIUM

### M1. Title or brand token ≥ ~32k chars makes `sanitize`/`wordRegex` throw `SyntaxError: Invalid regular expression` (regex too large), and the fallbacks degrade badly

V8 rejects the escaped title phrase regex (`new RegExp(esc(scan.title), 'giu')`) once the title passes ~32k chars
(10k–30k OK, 40k throws). It rejects a single brand token of the same size in `wordRegex` too. This throw is not
the dev-mode host check, so it **also happens in production**:

- `safe()` turns it into `''`. Every council turn and the verdict come back empty, and `verdict` is null.
- `vibe.ts:99`: `safe(summary).trim() || result.summary` then returns the **unsanitized** model summary, so the
  brand guardrail is bypassed. The fallback is older than this PR, but it is reachable through this throw. Keywords
  are dropped instead.
- `fontInfo` → `nameHasBrand` throws. Generate and Fidelity catch this and show "Could not generate", so the user
  cannot export at all for that scan. Any future caller without try/catch would blank the panel (there is no React
  ErrorBoundary in `apps/extension/src`).

**Scenario.** A page with a 40k-char `<title>` (or an imported scan carrying one) gets saved. Every export for it
fails, the council shows blank turns, and Vibe can show the brand name.

**Fix.**
- Apply the H1 cap, which removes the trigger.
- In `sanitize`, build each pattern inside try/catch. If one fails, fall back to a literal case-insensitive
  `split/join` removal for phrases and skip the token.
- In `vibe.ts`, never fall back to the raw text. Use `safe(...)` or a neutral "Description unavailable".

### M2. Imports have no size bounds per field, so an imported library can be slow forever

The 20 MB file cap is the only limit. The v4 schema has no `.max()` on any array or string, and the extractor's
caps (≤200 CSS variables, ≤200-char values, `VAR_NAME`) are not re-applied on import. Measured: a 18.8 MB file with
150k palette entries migrates in 0.73 s (v3 repair) or 0.14 s (v4) and is stored. `listScans()` then re-runs
`migrate()` on **every row on every list**, and the Palette, Inspect and Generate views render or iterate the full
arrays. One such import can make the Library slow to open. Because the heavy row is what the user must open to
delete it, the slowdown persists.

**Scenario.** Someone shares a "design library" `.specimen.json` with 150k swatches, 100k CSS variables and a huge
title (combine with H1). The user imports it, and the Library and Generate views lag or freeze on every visit.

**Fix.** Add bounds to the v4 schema that sit well above real scans: `palette ≤ 512`, `cssVariables ≤ 500` entries
with key `≤ 200` and value `≤ 500` chars, `title`/`url`/`host ≤ 2000`, `typography.styles ≤ 200`, `samples ≤ 200`
chars, `warnings ≤ 100`. Also cap scans per import file (for example 500). Truncating is friendlier than rejecting
for text fields, so do it in `migrate()` as a repair, and reject only arrays that are way over the bound. Optionally
cache migrated rows by `id` and `scannedAt` so `listScans` doesn't re-parse everything on each call.

---

## LOW

### L1. `repairColors` deep-clones the whole untrusted input, including unknown keys

`structuredClone(scan)` copies everything, including keys zod would strip. A v1–v3 import with a deeply nested
junk key gives `RangeError: Maximum call stack size exceeded`. That is caught in `importFile` (the row is skipped),
so nothing breaks today, but it is wasted work on attacker data and a crash vector if the call ever moves outside
a try. **Fix:** clone only `colors`, `variants` and `meta.warnings` (the parts it mutates), or run a first
`DesignScanObject.passthrough()`-free parse to strip unknown keys before repairing.

### L2. Imported `cssVariables` skip the extractor's name and value filter

On a live scan, `designVars` keeps only `VAR_NAME`-shaped keys and values ≤200 chars. An import accepts any key
(for example `constructor`, or names containing backticks) and values of any length. These go into DESIGN.md as
`` `name` | `value` `` cells. `cell()` escapes `|` and newlines but not backticks, so a value can break out of
inline code and place arbitrary markdown or instructions into the "agent-ready" export. That is text injection
into the user's coding agent from a shared file. **Fix:** re-apply `VAR_NAME` and the 200-char value cap on
`migrate()`, and escape or strip backticks in `cell()` for code cells.

### L3. Write helpers validate but store the unparsed object

`saveScan`, `replaceStoredScan` and `saveCompose` call `DesignScanSchema.parse(scan)` but then store `scan`, not
the parse result. `updateScan` stores `{ ...row, ...patch }` raw. Unknown extra keys therefore persist in IndexedDB.
The import path is safe (it passes `migrate()` output, which is already stripped), but any future caller that hands
in a spread of untrusted data would persist the extra payload. **Fix:** store the parsed value
(`const clean = DesignScanSchema.parse(scan); put({ ...clean, tags })`), and do the same for the merged
`updateScan` row.

---

Scratch scripts (not in the repo): `bench2.ts`, `bench3.ts` (sanitize old vs new), `imp.ts` (hostile imports),
`dm.ts` (DESIGN.md timing), in the reviewer's session scratchpad.
