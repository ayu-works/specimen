# SPC-33 lens B r1 (PR #35 @ 7364150)

Reviewer: second reviewer, lens B (adversarial). Read-only, except for this file.

**Verdict: CHANGES REQUESTED.** 0 CRITICAL / 1 HIGH / 2 MEDIUM / 4 LOW.

To check the producer findings I ran `vibe()` against `createMockProvider` with a scan whose host is `zentrix.io` and whose title is `Zentrix` (a tsx probe in my scratchpad; nothing in the repo changed).

## HIGH

### H1. The final cut can turn a longer word into a brand name (ethics guardrail)
`clamp()` in `packages/ai/src/features/vibe.ts:25-30` sanitizes and then calls `cutText(out.trim(), max)` again. That last cut can land inside a word. The sanitizer only matches brand tokens at word, case or digit boundaries, so it leaves `zentrixology` alone. Cut after `zentrix`, the word becomes a whole-word brand at the end of the text, and nothing sanitizes it again. The partial-word drop only runs after the *pre*-cut (`pre.length < text.length`), and only when the reply is over 2 × max long.

Reproduced:
- **Summary:** `'calm '.repeat(797) + 'airy ok zentrixology is calm'` (4021 chars, under the 8000 pre-cut) gives a summary that ends `… airy ok zentrix` (length 4000).
- **Keyword:** `'calm '.repeat(18) + 'ok zentrixology'` (105 chars, under the 200 pre-cut) gives a keyword that ends `… ok zentrix`.

That vibe then goes into the store, the Library row and the generated prompt's visual direction. CLAUDE.md says generated prompts must not contain brand names (tested). The trigger is a model echoing a page-derived word that contains the brand, with a cut at exactly the wrong offset. It's narrow, but the cut is the only thing that creates the brand, and the input can come from the page.

**Fix:** after the final cut, either run `safe()` once more (cheap, since the text is at most `max` chars), or drop the trailing partial word whenever *either* cut applied:
```ts
const cut = cutText(out.trim(), max);
return (cut.length < out.trim().length ? cut.replace(/\S*$/, '') : cut).trim();
```
Re-running `safe` is the more robust choice. Add T3.35 cases for the summary and the keyword. Both inputs above fail today.

## MEDIUM

### M1. The window in which a save error is lost is the whole LLM call, not "~ms", and a remount allows a second concurrent run
The orchestrator accepted lens A L1 on the grounds that the error is lost only "if Inspect unmounts during the ~ms write". But `TabsContent` (Radix, no `forceMount`, `App.tsx:184-200`) unmounts Inspect whenever another tab is active. The natural flow is: click "Describe the vibe", then go to **Generate** to use it while the model is still running. That takes seconds with an API, and tens of seconds with local Gemma.

The unmounted instance's run carries on. `current()` is still true, because its own `runId` ref is unchanged and the scan is the same. So it calls `setVibe` and `updateScan`. If the save rejects (quota, private window), `setSaveErr` hits an unmounted component and is dropped. When the user returns to Inspect, the vibe is shown with no alert: it looks saved. That is the bug this ticket fixes, on its most common path.

The remount also starts with `busy=false` and a fresh `runId`, so the user can start a second run while the first is still in flight. The two runs' `setVibe` and `updateScan` calls can interleave (A setVibe → B setVibe → B save → A save). The panel then shows vibe B while the Library holds vibe A, and no error is shown.

**Fix (no store.ts change needed):** report a save failure with the global `toast()` from `@/components/toast`, which is already used by Generate and Council and is mounted at the App level, as well as the inline alert. A toast survives the unmount. For the concurrent-run part, a module-level `let inFlight: Promise<void> | null` (or a module-level run counter in place of the `useRef`) keeps the guard across remounts. Add a T3.36 case: start a run, unmount the card, reject the save, and assert the toast.

### M2. A vibe that could have been saved is thrown away when the panel moves to another scan
`Vibe.tsx:37`: `if (!current()) return;` runs *before* `updateScan`. Take a Library scan A, click Describe, then open scan B from the Library before the model answers. A's vibe is discarded entirely, though `updateScan(A.id, …)` is addressed by id and can't touch B. The user paid for that call with their own API key, or waited out a local Gemma run. The handoff's goal, "a vibe for an old scan is no longer written onto the new one", only needs `setVibe` and the UI to be skipped.

**Fix:** when not current, skip `setVibe`, `setNote` and the alert, but still `await updateScan(scan.id, { vibe: next })`. Report a failure by toast (see M1), since the inline alert is tied to a scan no longer on screen. Add a test: switch scans mid-run and assert A's stored row has the vibe and B's doesn't.

## LOW

### L1. Non-string keywords, or a non-string summary, turn the raw JSON into the summary
`VibeSchema` is `keywords: z.array(z.string())`. A reply like `{"summary":"Calm and airy.","keywords":["calm",1,null]}` fails to parse, so the fallback stores the summary `Calm and airy.,keywords:[calm,1,null]` with no keywords (reproduced). Garbage then reaches the Library and the prompt. **Fix:** `keywords: z.array(z.unknown()).catch([]).transform(a => a.filter((k): k is string => typeof k === 'string'))`, or a preprocess that drops non-strings, plus a test.

### L2. The fallback `.slice(0, 280)` can split a surrogate pair
`vibe.ts:114`: with a non-JSON reply, `'x'.repeat(279) + '😀 rest'` gives a stored summary that ends in a lone `\ud83d` (reproduced). The clamp's surrogate test covers only the JSON path. **Fix:** `cutText(raw.replace(...).trim(), 280)`, and extend the surrogate test to the fallback.

### L3. Duplicate keywords: wasted slots and a React key collision
`['calm','calm','Zentrix calm']` gives `['calm','calm','calm']`, because sanitizing can create duplicates. `Vibe.tsx` renders `<Badge key={k}>`, so React warns about duplicate keys and the 8 slots fill with repeats. Before this PR the list was looked at 8 raw entries at a time; RAW_KEYWORDS now looks at 32, so repeats of a looping model fill all 8. **Fix:** dedupe, case-insensitively, after `filter(Boolean)` and before `.slice(0, MAX_KEYWORDS)`.

### L4. The busy state is now held through the IndexedDB write
If `updateScan` never settles (for example, the Dexie open is `blocked` by an old extension page during a version upgrade), the button stays on "Looking…" for good, though the vibe is already on screen. Before this PR the save was fire-and-forget. Minor. **Fix:** `setBusy(false)` once `setVibe` has run, and guard re-entry with the run counter instead. Or accept it and note it in the handoff.

Also noted, no finding needed:
- **No whitespace (CJK) or one long word:** a looping reply over 8000 chars with no spaces is wiped by the partial-word drop and surfaces as "The description was filtered (brand names are removed)". That wording is misleading, but the behaviour is the fail-closed result PE note 2 accepted.
- **Sanitizer cost:** `collect()` still runs `safe()` over the whole raw reply before `vibe()` sees it, so the clamp's "bounded work" is bounded only after `collect`. This predates the PR, and real providers enforce `maxTokens`.

## Checked, OK
- **No provider:** the hint shows and `run()` returns early.
- **Scan deleted meanwhile, or never in the Library:** `updateScan` is a no-op and nothing claims "saved".
- **Panel closed mid-save:** the IndexedDB transaction commits or doesn't, and no UI is left to lie.
- **Quota and private-mode errors:** these map through `libraryErrorText`, including Dexie's `inner` and `failures` wrapping.
- **Scan ids:** they include `scannedAt`, so a rescan of the same page gets a new id and the scan-id guard holds.
- **Stored text:** the sanitized, clamped text is what `setVibe` and `updateScan` receive. There's no raw path, apart from H1's post-cut brand and L1/L2's fallback text.
- **Surrogates:** `cutText` never ends on a high surrogate, on the JSON path.
- **v5 bounds:** keyword count ≤ min(8, `BOUNDS.keywords`), summary ≤ 4000 and each keyword ≤ 100, checked against `DesignScanSchema`. `model` is the provider id, which is short.
