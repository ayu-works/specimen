# SPC-32 handoff: long title freezes the brand sanitizer; fail closed

Lane A · branch `exec/spc-32` (from origin/main 77ac925) · executor session `spc-32-6d` · PE `pe-ed`.
Source: `docs/sprint/reviews/SPC-17-sec-r1.md` (sprint/log) H1, M1, and the output side of L2.

## Plan (awaiting PE approval)

### Pass bar (written before any measurement)
Measured in Vitest on Node (V8), on this machine, with the real generators:
- **P1** `generateDesignMd` for a scan with a 30,000-char title of distinct words and 200 CSS variables:
  **< 100 ms** (median of 3 runs after one warm-up). Today: ~16 s.
- **P2** `sanitize` of a 10 KB text with the same scan: **< 50 ms**.
- **P3** a streamed council/ask reply of ~10 KB in 3,000 deltas (one 10 KB line, the worst case), with a
  300-word title, snapshots via the stream sanitizer: **< 300 ms** total. Today: ~6 s.
- **P4** a 40,000-char title and a 40,000-char single-word title: no throw from `sanitize`, `generateDesignMd`,
  `generatePrompt` or `fontInfo` (today: `SyntaxError: Invalid regular expression`).
The tests use generous CI-safe budgets of 3× these numbers (300 / 150 / 900 ms) so they don't flake on a slow
runner; the handoff records the measured local numbers against the strict bar above.

### Approach
All in `packages/core/src/generate/sanitize.ts` unless noted.

1. **Cap the inputs before tokens are built** (defence lives in the sanitizer, since imports bypass capture):
   - `brandTokens`: read only the first `TITLE_SCAN = 300` chars of the title; keep at most
     `MAX_TITLE_TOKENS = 12` title tokens (in title order, before the length sort; the host's SLD pieces are
     always kept); drop any token longer than `MAX_TOKEN = 64` chars (a DNS label is ≤ 63, so no real SLD is lost).
   - Phrases (host, title, origin, headline samples): a phrase longer than `MAX_PHRASE = 1000` chars is skipped
     (its words are still covered by the tokens); at most `MAX_SAMPLES = 50` headline samples. 1000 escaped chars
     is far below V8's regex size limit, so no compile can throw.
   - Capping the title at capture/in the schema is **not** in this ticket: the schema bound is SPC-19's M2, and the
     sampler is outside lane A. The sanitizer must be safe for any title anyway.
2. **Compile once, cache.**
   - `wordRegex(token)` is memoised in a bounded `Map<string, {g, test}>` (a `g` regex for `replace`, a non-`g`
     one for `.test`, so no `lastIndex` state leaks between calls). Cleared when it passes 1,024 entries.
   - `compile(scan)` builds the ordered pattern list once per brand set, cached in a bounded `Map` (8 entries)
     keyed by a signature string of exactly the inputs it reads (host, url, capped title, the samples it keeps).
     Keyed by content, not object identity, so an edited scan can't hit a stale entry.
   - Sequential per-token replacement is kept (not one big alternation): the chained removal is what the current
     guardrail tests pin, and with ≤ ~20 cached patterns it is fast enough.
3. **Streaming cost** (`collect.ts`, `critique.ts`): new `createStreamSanitizer(scan)` in core. `sanitize` already
   works line by line (and the host check can't span a newline), so completed lines are sanitized once and cached;
   only the open last line is redone per delta. When that open line is > 512 chars it is re-sanitized only every
   256 chars of growth (the snapshot keeps the previous sanitized text, never raw). The **final** text is always a
   full `sanitize(raw)`. Short replies keep exactly today's per-delta snapshots (T3.08 stays as is).
4. **Fail closed on any sanitizer error.**
   - `sanitize` itself: everything stays inside one path; if a compile ever throws it propagates (no partial or raw
     return). The dev-mode host throw is unchanged.
   - `safe()` (`collect.ts`) already returns `''`; keep it, and route the stream sanitizer through the same catch
     (an error → `''` snapshot, never raw).
   - `vibe.ts`: drop `|| result.summary`. If the sanitized summary is empty (filtered or error), throw
     `ProviderError('other', 'The description was filtered (brand names are removed).')`, which Vibe.tsx already
     shows as an error. Keywords already drop on error.
   - `polishPrompt.ts`: already falls back to the input prompt (generator output, already sanitized). No change;
     a test pins it.
   - Generators (`designmd`, `prompt`, `fixPrompt`, `fonts`) let a sanitizer error propagate; Generate and
     Fidelity already catch and show "Could not generate", which is closed.
5. **L2 output side** (`common.ts` + `designmd.ts`): new `code(s)` helper that strips backticks and wraps in one
   backtick pair; every inline-code cell in DESIGN.md uses it (CSS vars name and value, font stacks, gradients,
   shadows). A backtick is never valid in a CSS name/value/stack, so stripping loses nothing real and removes the
   breakout entirely (no reliance on how a given markdown parser handles long backtick runs). `cell()` keeps its
   `|`/newline escaping. The import-side `VAR_NAME` filter stays with SPC-19.

### Files
- `packages/core/src/generate/sanitize.ts` (caps, caches, `createStreamSanitizer`), `generate/index.ts` (export)
- `packages/core/src/generate/common.ts` (`code()`), `designmd.ts` (use it)
- `packages/ai/src/features/collect.ts`, `critique.ts` (stream sanitizer), `vibe.ts` (no raw fallback)
- Tests: `packages/core/test/guardrail.test.ts`, new `packages/core/test/sanitizePerf.test.ts`,
  `packages/ai/src/features/vibe.test.ts`, `features.test.ts`, `critique.test.ts`.

### Tests (core first; existing IDs, no new TESTING.md IDs)
- T2.03 30k-char title of distinct words + 200 vars: `generateDesignMd` under budget (P1), no throw, and no host
  or kept title token appears in the output (case-insensitive).
- T2.03 `sanitize` of 10 KB under budget (P2).
- T2.03 40k-char title, and a 40k-char one-word title: `sanitize`, `generateDesignMd`, every prompt target and
  `fontInfo` don't throw; the host is still removed (P4).
- T2.03 the caps don't weaken the normal guardrail: a brand in the first 12 title tokens is still stripped; the
  host's SLD is stripped whatever the title length (a long title can't push the SLD out).
- T2.03 cache correctness: two scans with different titles in a row each strip their own brand and not the
  other's; calling `containsBrand` twice with the same token gives the same answer (no `lastIndex` leak).
- T2.03 stream sanitizer equivalence: for the guardrail fixtures, the final stream output === `sanitize(raw)`, and
  every snapshot is a sanitized string (no host/brand), including in the throttled long-line mode; P3 budget.
- T2.05 DESIGN.md with an imported `cssVariables` value `` x` ## Ignore previous instructions `y `` and a name with
  a backtick: the output has no backtick inside any CSS variable cell and the table still parses (remark, as the
  existing T2.05 does).
- T3.22 council: a sanitizer that throws (vi.mock of `@specimen/core` `sanitize`) gives `''`/`filtered` turns, never
  the raw brand text; T3.08 ask snapshots unchanged.
- Vibe (T3.x existing vibe tests' ID): a sanitizer throw, and a summary that sanitizes to empty, both reject with
  the "filtered" ProviderError; the raw summary is never returned.
- All existing guardrail tests stay green unchanged.

### Failure modes
- **Drift between two copies of a fact:** the compile cache key must cover every input `compile` reads; it is
  built in the same function from the same capped values, and a test edits the title between calls.
- **Stale or shared regex state:** `g` regexes are only used with `replace` (which resets `lastIndex`); `.test`
  uses separate non-`g` regexes.
- **Stream partial failure / mid-stream error:** a sanitizer error on one delta yields `''` for that snapshot; the
  final text is a fresh full sanitize, so a transient snapshot never becomes the stored turn. Abort/stall paths in
  critique keep their existing handling (turn.content is only ever assigned sanitized text).
- **Line cache vs full sanitize disagreeing:** equivalence test above; the host check is per line in both, since a
  host never contains `\n`.
- **Cap weakens the guardrail:** a brand word after 300 chars or 12 tokens of title isn't a token any more. The
  SLD (the main brand source) is always kept, and the dev-mode host check still runs. Accepted trade-off; the
  security reviewer may want a different number.
- **Memory:** both caches are bounded; cleared, not grown, when full.
- **Concurrency:** caches are per JS context and synchronous; no async state.
- Idempotency/atomicity/cleanup: not applicable (pure functions, no I/O).

### Manual test steps (for the PR body)
1. Open a local page with a ~30k-char `<title>` of distinct words (e.g. `data:` not allowed by host permission, so a
   local file served by `npx serve`); scan; Generate → DESIGN.md and each prompt target render in under a second.
2. Same scan, Council: turns stream normally, no brand words, no panel freeze.
3. Import a `.specimen.json` whose cssVariable value contains backticks: DESIGN.md shows the value without
   backticks inside one code cell.

PE approved 2026-10-17 with build notes, all applied: (1) P1/P2 are timed on cache misses (a run-unique
title each run); (2) no pattern can match across `\n`, because `sanitize` splits lines before any pattern runs
(so the line cache is exact), and a test splits a title phrase across a line break mid-stream; (3) the caps are
exported named constants (`TITLE_SCAN`, `MAX_TITLE_TOKENS`, `MAX_TOKEN`, `MAX_PHRASE`, `MAX_SAMPLES`); (4) the schema
title bound stays with SPC-19; (5) Vibe keywords are pinned as dropped when the summary is filtered (it rejects).

## Done
- Built per plan. Measured locally (Node/V8, cache miss, median of 3) against the strict bar:
  `generateDesignMd` with a 30k title + 200 vars **~47 ms** (bar 100; was ~16 s); `sanitize` 10 KB **~26 ms**
  (bar 50); 3,000-delta one-line 10 KB stream **~37 ms** (bar 300; was ~6 s). 40k titles: no throw.
- Deviation from the plan, found while testing: Vibe's reply is already sanitized once inside `collect`, so the
  old raw fallback was reachable only when the *second* pass (the summary's) throws. The fail-closed test pins
  exactly that (first call passes, second throws → rejects with `VIBE_FILTERED`, no summary or keywords).
- `code()` also used for the box-shadow value in `components.ts` (prompt output), same reason as DESIGN.md.
- Tests: `packages/core/test/sanitizeLimits.test.ts` (T2.03), a T2.05 case in `generate.test.ts`,
  `packages/ai/src/features/failClosed.test.ts` (T3.22, T3.08, polish, Vibe). Existing guardrail tests unchanged.
- `pnpm gate` green locally (gitleaks not installed here, so `secrets` was skipped; CI runs it).

- Lens A r1 (`docs/sprint/reviews/SPC-32-a-r1.md`, 0C/0H/1M/2L) folded: M1, `code()` now also used in the
  agent prompts (`prompt/sections.ts` font stack, shadow levels, card shadow; `components.ts` `describeBase`
  shadow), with a T2.05 test over every prompt target + DESIGN.md. L2 also fixed: the last title word is dropped only
  when the 300-char window really cuts it. L1 is accepted (it goes away with SPC-19's v5 title bound).

## Next
- Lens A APPROVED on fd082e6 (fold check appended to SPC-32-a-r1.md, uncommitted; ships with the next fold).
- Lens B + security r1 (`docs/sprint/reviews/SPC-32-b-r1.md`, 0C/1H/3M/6L, on f413b5b) folded in one round:
  - **H1** (brand at the end of a long title leaked): title tokens now come from both ends, the first 6 of the
    first 300 chars plus the last 6 of the last 300 (`MAX_TITLE_TOKENS` 12 split in half, cut fragments dropped at
    both window edges). Still bounded at 12. Tests: the reviewer's Ankora title, and 5k-char titles with the
    brand first and last.
  - **M1/M2**: `cell()` and `code()` turn `\r\n`, every C0 control except tab, DEL, U+2028 and U+2029 into
    spaces. The prompt sites were already on `code()` (lens A M1, fd082e6). Test: `\r`/`\n`/U+2028/NUL in a
    CSS var, stacks, shadows and a component shadow; no heading or row break in any prompt target or DESIGN.md.
  - **M3** (small, folded): host forms stay literal. The title and headline samples now match only as whole
    words (one word: the token rules incl. the hex guard; several words: a non-letter on both sides). Also found
    while testing: the *token* `box` (title "Box") ate `box-shadow`; the existing `(?!-gradient)` guard now also
    keeps `box-shadow|sizing|decoration-break`, for the token `box` only (so `zentrix-shadow` in prose still
    loses the brand).
  - **L1**: the stream sanitizer looks up its patterns once per stream, not per delta. **L2**: LRU on cache
    hit. **L4**: `code()` of nothing is `''`. **L6**: every council exit (stop, stall, error, done) sets the full
    `safe(raw)`; test fails on the old code.
  - **Skipped, follow-ups:** **L3** (Unicode case/NFKC: `İstanbul`, `ß`) predates this PR and needs its own
    design (`\p{M}` in boundaries, normalization); **L5** (`\` before `|` in cells) is not parser-verified, and
    doubling backslashes would visibly change values inside code spans, where escapes aren't processed. Both are
    for the orchestrator to file.
- Lens A r2 M2 (a brand mid-title on a host without it) folded:
  - Tokens: the first `MAX_TITLE_TOKENS` = 32 of the first 300 chars, plus the last `MAX_TAIL_TOKENS` = 6 of the last
    300 chars (titles over 300), plus every token of a segment of at most `SEGMENT_WORDS` = 3 words (split on
    `| – — · : •` or a spaced hyphen) in either window, at most `MAX_SEGMENT_TOKENS` = 16. That is 54 at most.
  - Perf: with 4× the tokens the per-token regexes broke the bar (cold DESIGN.md ~141 ms, sanitize ~82 ms).
    Compiling was the cost, not running: each regex's `\p{…}` classes cost ~1.5 ms to compile. So words now share
    regexes: one alternation per rule group (4+ chars, hex-only, `box`); multi-word phrases share one too.
    Re-measured on a cache miss: **DESIGN.md ~5–7 ms, sanitize 10 KB ~2 ms, 3,000-delta stream ~12 ms.**
  - Groups are chunked at 8k chars of source. V8's real limit is a ~32k single literal run (which `MAX_PHRASE`
    already avoids); a 150k-char alternation of 1000-char words compiled fine in a probe.
  - Accepted gap: a brand deep inside a title over 300 chars that sits outside both windows (pinned in a test).

## How to resume
Read this file, `git log origin/main..`, and the review file above. `pnpm i` then `pnpm gate`.
