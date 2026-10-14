# SPC-22 handoff: critique-panel spike (behind a flag)

Executor: spc-22-f2 · Branch: exec/spc-22 · Lane C · Sprint 2 · PE: pe-1b · Orchestrator: specimen-53

## Plan (PE pe-1b approved 2026-10-15 with changes 1–7, folded in below under "PE changes")

### Scope (from plan.md "Hard limits" + the "Sprint plan overrides" comment)
Off-by-default flag, dev build only (no CWS release); 2–3 personas; every turn grounded in `compactScan` inside
`<page_data>` and passed through the brand sanitizer; visible cap (default 3 reviewers × 2 rounds + 1 summary) and a
Stop button that aborts everything; `LLMProvider` only; with no provider the same setup hint as Ask; mock provider in
tests; no `site/` change; no `DesignScan` schema change.

### Engine: `packages/ai/src/features/critique.ts` (pure, no `chrome.*`, no DOM)
```ts
export type PersonaId = 'brand' | 'a11y' | 'frontend' | 'skeptic';
export interface CritiqueTurn { kind: 'persona' | 'human' | 'summary'; persona?: PersonaId; content: string;
  status: 'streaming' | 'done' | 'stopped' | 'error' | 'filtered'; error?: string }
export interface CritiqueOptions {
  personas?: PersonaId[];   // default ['brand','a11y','frontend']; clamped to 2–3, deduped
  rounds?: number;          // default 2; clamped to 1–3
  signal?: AbortSignal;
  onTurn?: (index: number, turn: CritiqueTurn) => void;  // start/stream/end snapshots (sanitized)
  takeHuman?: () => string[];  // drains the human's queued messages; called before every model turn
}
export interface CritiqueResult { status: 'done' | 'stopped' | 'error'; turns: CritiqueTurn[];
  summary: { keep: string[]; change: string[] } | null; error?: string }
export function critiquePlan(opts): { personas: PersonaId[]; rounds: number; totalTurns: number } // for the cap label
export function runCritique(provider, scan, opts): Promise<CritiqueResult>
export function parseKeepChange(text): { keep: string[]; change: string[] } | null
```

**Turn-taking.** One provider plays every persona (works with a single BYOK key; Groq is fast enough). Fixed
round-robin: round 1 = p1, p2, p3; round 2 = p1, p2, p3; then one summary turn ("moderator"). Total model calls =
`personas × rounds + 1` (default 7, hard max 3×3+1 = 10). Each call is a fresh `provider.chat` with:
- `system` = persona brief + shared rules + `PAGE_DATA_RULE` + `wrapPageData(compactScan(scan) + contrast, budget)`
  (same helpers and budget as `ask()`). "contrast" = the scan's measured contrast pairs (`scan.a11y?.pairs`, else
  `computeA11y(scan.colors)` from core; no schema change), compact `{fg, bg, roles, ratio, aa}`, so the a11y reviewer
  cites real ratios rather than guessing.
- `messages` = **one** user message: the transcript so far rendered as `[Brand designer]: …` / `[Human]: …` lines,
  then "It is your turn as <persona>. Respond to the others, address any Human message first, cite measured values,
  ≤ 120 words." One user message avoids role-alternation rules (Anthropic/Gemini) and keeps the adapter path identical
  to `ask()`. `maxTokens` 400 per turn, 700 for the summary; temperature 0.6 (0.3 summary).
- Turns are streamed through the existing `collect()` (sanitized snapshots), so the sanitizer runs on every turn.

**Persona prompts** (short, opinionated, all share "Use only the measured data. Do not name the website or brand. No
headline copy. If something wasn't measured, say so."):
- **Brand designer:** visual identity: palette personality, accent use, type pairing and scale, overall mood and
  consistency.
- **Accessibility reviewer:** contrast pairs (quote the ratios, AA/AA-large), type sizes and line heights for
  readability, link and muted-text legibility, dark/light scheme.
- **Front-end developer:** systematization: is the spacing a clean scale on the base unit, how many radii/shadows/
  font sizes, token-ability, container and breakpoints, how hard it is to rebuild.
- **Skeptic** (optional 4th choice, off by default): challenges the others' claims against the numbers.
- **Summary (moderator):** "Write exactly two lists. `Keep:` then up to 5 `- ` bullets, `Change:` then up to 5 `- `
  bullets, each ≤ 20 words with a measured value. Reflect the Human's priorities." `parseKeepChange` reads it leniently
  (headings case-insensitive, `-`/`*`/`1.` bullets); if it fails, the UI shows the raw sanitized text.

**Human steering.** The UI queues messages (no turn is interrupted). Before each model turn the engine calls
`takeHuman()`, appends each as a `human` turn (text trimmed, clipped to 1000 chars) and the next speaker is told to
address it. A message sent during the summary or after the end is shown but not used (input disabled once the summary
starts). Human messages don't add model calls, so they never raise the cost cap. Human text is the user's own steering,
so it is outside `<page_data>`, but it is labelled `[Human]:` inside the transcript; it is never sent anywhere else.

### Cap and abort
- Cap is enforced in the engine (clamps 2–3 personas, 1–3 rounds), not only the UI. UI shows "Turn 3 of 7 · Groq"
  before start ("Starts 7 calls to <provider>") and during the run.
- One `AbortController` per run; its signal goes to every `provider.chat`. Before each turn the engine checks
  `signal.aborted`; on abort (a `ProviderError('aborted')` or `AbortError` from the stream) the current turn is
  marked `stopped` with its partial sanitized text, no further calls are made, result `status: 'stopped'`.
- Stop button = `controller.abort()`. Leaving the scan (scan id changes) or unmounting the panel's store owner also
  aborts. One run at a time (Start disabled while running).

### Flag
`chrome.storage.local` key `flags.critique` (boolean, default absent = off). Read once on side-panel load and watched
via `storage.onChanged`. Two ways to enable, both documented in the PR:
1. Options page opened with `?labs=1` (`chrome-extension://<id>/options.html?labs=1`) shows a "Labs" card with a
   "Critique panel (experimental)" checkbox; without `?labs=1` the card is not rendered.
2. Fallback: side-panel DevTools console `chrome.storage.local.set({'flags.critique': true})`.
Off = no tab, no code path reachable. Helpers in `apps/extension/src/lib/flags.ts` (`loadFlag`, `setFlag`, `watchFlag`).

### UI
- New side-panel tab **"Critique"**, rendered only when the flag is on (`TabId` gains `'critique'`; App filters TABS).
- `views/Critique.tsx`: no scan → same "Scan a page first" state as Ask; no provider → the same setup card as Ask
  (`SETUP_HINT`, Open Settings; locked/loading variants). Setup card: persona toggles (2–3 of 4, default 3), rounds
  (1–3, default 2), cap line "7 calls to Groq", Start. Running: transcript bubbles with persona name/color, a "Turn 3
  of 7" progress line, Stop button, input "Steer the panel…" (queues). Done: keep/change lists in two cards + "Copy" +
  "Start over". Error: the turn shows the friendly `ProviderError` message, earlier turns stay, "Start over".
- State lives in a small zustand store in `views/critiqueStore.ts` (module-level, like Ask's `chats`) so switching tabs
  doesn't kill a run (Radix unmounts inactive tabs). Not persisted to IndexedDB (spike).
- Footer note as in Ask: "Each turn sends the measured values (no page text) to <provider>."

### Failure modes
- **Abort mid-stream:** current turn → `stopped` with partial text; no more `chat` calls; result `stopped`; UI back to
  idle with transcript kept. Abort before the first token / between turns: no call is made after abort.
- **Provider error mid-round** (auth/rate/network/other): stop the whole run (repeating would repeat the cost and the
  error); the failing turn → `error` with the friendly message; earlier turns kept; no summary; `status: 'error'`.
- **No provider:** never reaches the engine; setup card identical to Ask (same `SETUP_HINT` string).
- **Over-long history vs context budget:** per turn, char budget ≈ `contextTokens × 3 − system.length − maxTokens × 4`
  (floor 1500). Each transcript entry clipped to 1200 chars; then drop the **oldest** entries until it fits, keeping
  the newest and always the latest Human message, with an `[earlier discussion omitted]` marker. Groq (128k) never
  trims; small Gemma does.
- **User message mid-turn:** queued, never interrupts the stream; attached before the next model turn; shown at once
  in the UI as "queued" then placed in the transcript. After the last persona turn: input disabled.
- **Sanitizer:** every turn via `collect()` → `safe()`; the transcript fed to later turns is built only from sanitized
  text, so a brand name produced in turn 1 can't reach turn 2's prompt either. If sanitize empties a turn (`safe` → ''),
  the turn is `filtered` ("This turn was removed by the brand filter") and left out of the next prompts. Summary bullets
  come from sanitized text.
- **Scan changes mid-run:** abort, reset the store for the new scan.
- **Concurrency:** one run at a time (module-level controller, Start disabled while running).

### PE changes (approval conditions, 2026-10-15)
1. **Abort without an error.** After every `collect()` the engine checks `signal.aborted`; if set, the turn is
   `stopped` (not `done`) and no further call or summary runs, even if the stream returned normally (llmHost/WebLLM
   interrupts end streams that way). T3.20 adds a hand-written provider whose stream simply returns once the signal
   aborts: turn `stopped`, result `stopped`, no next call.
2. **Rate limits.** On `ProviderError('rate')` the same turn is retried **once** after a backoff (default 8 s,
   injectable for tests) that Stop cancels; the UI shows "Rate limited, retrying in Ns" (an `onTurn` snapshot with
   `retryInMs`). Retries never add turns; a second `rate` on the same turn fails the run. **Token estimate per run**
   (default 3 × 2 + 1): system ≈ persona 0.3k + page data ≤ 14k chars ≈ 3.5k tokens; transcript grows to ≈ 1k tokens;
   output ≤ 400 (summary 700) → ≈ 4–5k tokens per call, **≈ 30–35k tokens per run**. `critiquePlan()` returns
   `estTokens` = `calls × (system chars / 4 + maxTokens) + transcript growth`, shown on the cap line ("7 calls ·
   ~32k tokens to Groq"). T3.21: rate once → retried → run continues; rate twice → error; abort during backoff →
   `stopped`, no retry call.
3. **Error text.** Turns and UI show a fixed message per `ProviderError.kind` (auth / rate / network / other; aborted
   = stopped), never `e.message` (adapters can echo provider bodies that may contain part of a key). Test: an error
   whose message contains a fake key-like string (`sk-test-FAKEFAKE…`) never reaches the turn, the result or the UI.
4. **Sanitizer test not vacuous.** T3.22's mock output mixes a brand token from the scan's host/title with measured
   values ("Zentrix uses #1a2b3c at 16px"); assert the brand is gone **and** the hex/px survive, in `onTurn` snapshots,
   the transcript and the next request. The `filtered` case is a separate assertion.
5. **Flag.** On only when the stored value is `=== true` (`"false"`, `"true"`, `1` are off); a `storage.get` rejection
   = off. Both cases in T3.26.
6. **T3.26** also covers: a scan change mid-run aborts the run (no further calls), and the summary never runs after
   Stop.
7. **Contrast pairs** go **before** `compactScan` inside `<page_data>`, capped at the 12 worst ratios, so tail
   truncation on small-context providers cuts the scan JSON first, not the contrast data.
- LOW (taken): T3.24 asserts each request's user message fits `max(computed budget, floor)`. The floor is 2000 chars
  (not 1500) so the always-kept latest Human message (≤ 1000) plus the instruction fit under it.
- `maxTokens` per turn is 1200 (summary 1500), not 400/700: Groq's default `gpt-oss-20b` is a reasoning model and
  reasoning tokens count against the limit, so 400 could return an empty reply. Brevity comes from the prompt
  (≤ 120 words). The token estimate uses the expected output (~250/turn), not the ceiling.

### Known limitations (not fixed here)
- Sanitizer camelCase gap (audit H3: "zentrixBlue" survives) is SPC-17's fix in core; no test here expects it.
- With local WebLLM, Stop on a critique can truncate a concurrent Ask chat (audit H1, SPC-18).

### Files
- `packages/ai/src/features/critique.ts` (+ `critique.test.ts`); export from `packages/ai/src/index.ts`.
- `apps/extension/src/lib/flags.ts`; `apps/extension/src/entrypoints/sidepanel/views/Critique.tsx`,
  `views/critiqueStore.ts`; minimal wiring in `sidepanel/App.tsx` + `store.ts` (`TabId`); Labs card in
  `options/main.tsx` (small `options/Labs.tsx`).
- `apps/extension/test/critique.test.tsx`.
- `docs/TESTING.md`: new rows (below) — PE owns the IDs, needs your OK. No `site/`, no schema change.

### Tests (all mock provider, no network; proposed IDs, Phase 3)
- T3.18 U grounding: every call's system has the persona brief, `PAGE_DATA_RULE`, `compactScan` + contrast inside one
  `<page_data>`; an injection string in the scan stays inside it.
- T3.19 U turn order + cap: default = 7 calls in order brand, a11y, frontend ×2, summary; clamps (rounds 9 → 3,
  4 personas → 3, 1 persona → 2 defaulted); `critiquePlan().totalTurns` matches calls made.
- T3.20 U abort: abort during turn 2 (mock `delayMs`) → 2 calls total, turn 2 `stopped`, result `stopped`; abort
  before start → 0 calls.
- T3.21 U provider error mid-round: `ProviderError('network')` at turn 3 → no 4th call, turns 1–2 `done`, turn 3
  `error` with the fixed per-kind text (never `e.message`, incl. a fake key-like string), no summary. Plus the rate
  cases from PE change 2 (rate once → retried, continues; rate twice → error; abort during backoff → stopped).
- T3.22 U sanitizer: mock output containing the scan host → no `onTurn` snapshot, transcript entry or later request
  contains it; a turn that sanitizes to '' is `filtered` and excluded from later prompts.
- T3.23 U human steering: a message queued during turn 1 appears as `[Human]:` in turn 2's request (clipped to 1000),
  is a `human` turn after turn 1, and the call count is unchanged.
- T3.24 U context budget: contextTokens 2048 + long turns → every request's message fits the budget, newest kept,
  latest Human kept, omission marker present.
- T3.25 U `parseKeepChange`: well-formed, variant bullets/headings, garbage → null.
- T3.26 C Critique view: flag off → no tab; flag on → tab; no provider → setup hint (`SETUP_HINT`, Open Settings);
  with the mock provider: cap line, streams turns, Stop aborts (no further calls), keep/change cards render.
- T3.27 🖐 Owner: real Groq run on 2–3 sites; go/no-go comment on SPC-22.
No e2e for the spike (the component test covers the UI path; adding a Playwright flag fixture isn't worth it for a
spike). `pnpm gate` (incl. check-ids --all) green.

## Done (2026-10-15)
- Plan approved by pe-1b with changes 1–7 (folded in above).
- Engine `packages/ai/src/features/critique.ts` + `critique.test.ts` (T3.18–T3.25, 16 tests, mock/hand-written
  providers only). Exported from `@specimen/ai`.
- Extension: `lib/flags.ts`, `options/Labs.tsx` (+ `?labs=1` in `options/main.tsx`), `sidepanel/views/Critique.tsx`,
  `views/critiqueStore.ts`, tab wiring in `App.tsx` + `TabId` in `store.ts`; `test/critique.test.tsx` (T3.26, 8 tests).
- `docs/TESTING.md`: T3.18–T3.27 rows. No `site/` change, no schema change, no manifest/permission change.
- `pnpm gate` green locally (secrets step skipped: gitleaks not installed locally; CI runs it).

## Review round 1 (lens A `SPC-22-a-r1.md`, lens B + privacy `SPC-22-b-r1.md`), fixed in one commit
- **A-M1** `parseKeepChange`: a heading must be the word alone or followed by a colon (`/^(keep|changes?)\b\s*(?::…)?$/`);
  the probe is in T3.25.
- **A-M2 / B-M1** flag off mid-run: `Panel` resets the run when the flag reads `false`. `useFlag` is now
  `boolean | null` (null while loading), so a first render doesn't reset the run or move the tab. Tested in T3.26.
- **B-M2** provider/key switch mid-run: the store keeps `runProvider`; `guardProvider(ai.provider)` in `Panel` stops
  the run when the resolved provider changes. A `webllm` → `webllm` reload is exempt, because a local model sends
  nothing off the device. The progress line shows the run's provider. Tested in T3.26.
- **B-M3** stall: per-attempt idle timer (120 s to the first text, which covers a local model load; 30 s between
  pieces of text) ends the run with a fixed "stopped responding" message. A user Stop is told apart from a stall.
  Tested in T3.21.
- **B-H1** Groq free tier (orchestrator asked for a waiting state, not a failure):
  - **Measured.** Grounding on the real captures is 2.8–4.0k chars. Input per turn is ~1.0–2.4k tokens (at 3.5
    chars/token), growing with the transcript. A default run is ~13–15k tokens at ~250 output tokens per turn, and
    ≤ ~22k if every reply uses its full `maxTokens`. Lens B's ~5k/call assumed a 14k-char page-data block; real scans
    use about a quarter of that.
  - **Pacing.** `PROVIDER_TPM = { groq: 8000 }`. Before each call the engine reserves input chars/3 plus `maxTokens`
    in a rolling 60 s window, and waits (status `waiting`, live countdown, Stop cancels) until the call fits. The cap
    line says "Paced under 8k tokens/min, about N min" (≈ 3 min for a default run).
  - **Retries.** On a 429 that still slips through, the turn retries up to 3 times after 20/30/30 s waits ("Rate
    limited by the provider, waiting Ns"). Only after that does the run end.
  - **Not done:** `retry-after` header parsing. It needs `httpError`/`ProviderError` (outside lane C, PE contract);
    it's a follow-up if pacing proves insufficient.
- **B-H2** runtime flag ships with the next release: **owner decision, pending** (the orchestrator asked me not to
  change the flag mechanism until they reply).
- **A-L1 / B-L2** cost: the cap line shows a range (`estTokens`–`maxTokens`), and the upper bound counts the full
  `maxTokens`, which includes reasoning.
- **A-L2** 4k contexts: per-turn `maxTokens = min(1200, contextTokens/4)` (summary `min(1500, …)`).
- **A-L3** T3.18 now checks each call's brief, in order, including the summary's.
- **B-L1** an empty reply → turn `empty` ("returned no text…"); the run continues; an empty summary shows "No
  summary was produced". `reasoning_effort` for gpt-oss is an adapter change (outside lane), noted as a follow-up.
- **B-L3** the system prompt is now rules → `<page_data>` → role brief, so every turn shares a cacheable prefix
  (T3.18 asserts that the prefix is identical).
- **B-L4** (partial brand prefix in a stopped or truncated turn): justified, not fixed. It's a prefix, not the name;
  stopped turns aren't fed forward; a whole-word filter can't judge a half word. Known limitation.
- **B-L5** (a message sent during a backoff reaches the next reviewer, not the retried one): justified. The queued
  bubble already says "Queued for the next reviewer". Known limitation.
- **B-L6** WebLLM keeps generating after the panel closes: known limitation (audit H2, SPC-18).

## Review round 2
- Lens A r2 (`SPC-22-a-r2.md`): **APPROVED**, 2 LOW notes (TPM is per model, not per provider; one call's estimate
  can exceed the TPM). No change for the spike; watch both in T3.27.
- **H2: owner chose A; merge only after go** (2026-10-15, via specimen-53). No build-time gate. PR #25 is not merged
  until the owner's go/no-go. The owner tests from this branch's build. Nothing to implement.
- Status: stopped, waiting for the owner's decision (T3.27). The worktree stays until then.

## Next
- Reviews: PE lens A + lens B + privacy. Fold findings as new commits.
- Owner: T3.27 (Groq on 2–3 real sites, go/no-go on SPC-22). Steps are in the PR body.

## How to resume
Branch `exec/spc-22` in `worktrees/spc-22`; PR is open against `main`. Read `docs/sprint/reviews/` for SPC-22 findings,
fix in new commits, rerun `pnpm gate`, tell the reviewer what changed.
