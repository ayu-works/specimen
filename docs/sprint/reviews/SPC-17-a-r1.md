# SPC-17 review, lens A + contract (DesignScan v4), round 1

Reviewer: pe-99 (PE). PR #29, head `79ab376`. 2026-10-15.
**Verdict: APPROVED. 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW.** One condition: CI `gate` must be green on `79ab376`; it
was pending when I checked. There is one follow-up suggestion for another lane, below.

## Contract: matches the owner-approved v4 exactly
- `SCHEMA_VERSION = 4` and `schemaVersion: z.literal(4)`. The literals in compose, extract and merge read
  `SCHEMA_VERSION`, and the fixture and sample scan are bumped.
- `HexSchema = /^#[0-9a-f]{6}$/` on `ColorTokenSchema.hex`, so it covers the base palette and the variant palettes
  (through `ColorsSchema.partial()`).
- A `superRefine` on the top-level object checks every base role against the base palette, and every dark/light
  variant role against `variant.palette ?? colors.palette`, the same lookup as `roleColors`. The `DesignScanObject` /
  `DesignScanSchema` split keeps `.partial().extend()` on `ColorsSchema` working. No caller uses
  `.shape`/`.extend` on the refined schema.
- **Migration:**
  - v1–v3 go through `repairColors` on a `structuredClone`: a parseable hex is normalized to lowercase `#rrggbb`
    with `oklch` recomputed and alpha kept in its own field; an unparseable token is dropped; roles that point nowhere
    are dropped, including variant roles against the variant-or-base palette; one `Repaired on upgrade: …` warning is
    added only when something changed.
  - v4 is parsed strictly. Newer than v4 throws as before.
  - `parseColor` returns null and never throws on garbage, so a repairable row can't be lost to an exception.
  - Rows that are structurally broken (a non-string `hex`, missing fields) were already rejected under v3, so that's
    no regression.
- **No saved scan is hidden** (my condition 2): T1.01 runs every fixture page and raw capture (`ALL_NAMES`), a merge,
  a compose and a derived counterpart through v4, with no repair change. `listScans` lists a v3 row with an
  unreadable color, repaired, and Generate runs (T4.01). A measured theme variant (`toVariant`) only keeps roles that
  map into its own renamed palette, so it satisfies v4 too.
- **Imports:** a broken v4 row is skipped and a v3 row is repaired (T4.03).
- The warning is recomputed per read and isn't stored back, so it doesn't stack (tested).

## Part 1 (sanitizer): fine
- Hump, digit and caps-run boundaries use a case-sensitive regex with the token spelled in any case per character.
  The `/iu` `\p{Lu}` trap is avoided. `containsBrand` no longer lower-cases.
- `nameHasBrand` only applies the substring rule to tokens of 4+ characters (my condition 1). `--php-version` on
  `hp.com` is kept.
- The prose guards (`Calendar`/`cal`, `linear-gradient`) are tested, and the T2.03 DESIGN.md and host-form checks use
  plain substring search.

## Follow-up suggestion (not this PR; lane B owns `db.ts`)
`saveScan` and `updateScan` write without validating, and `listScans` silently skips a row that fails `migrate()`.
With v4 strict, a future writer bug (a variant whose roles point nowhere) would make the whole scan vanish from the
Library on the next read, with no error at write time. Suggest validating with `DesignScanSchema.parse` in
`saveScan`/`updateScan`, so the failure shows where it happens. That's a small ticket for lane B after SPC-26.
