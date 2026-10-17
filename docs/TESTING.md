# Test Plan

Every phase has a test suite with stable IDs (`T<phase>.<nn>`). Test names must start with the ID so the gate can check coverage:

```ts
it('T1.09 accent role within ΔE<3 of ground truth', () => { … })
```

**Phase gate** = `pnpm gate` green **and** every ID listed for the phase is present and passing (`scripts/check-test-ids.ts` greps the test files against this document). Manual checks (🖐) are run by Opus/you, and the results go in the PR description.

Types: **U** = unit (Vitest, Node) · **C** = component (Vitest + Testing Library, jsdom) · **E** = e2e (Playwright + Chromium with the built extension) · **🖐** = manual · **⊘** = dropped: the row and ID stay for the record (IDs are never reused), check-ids skips it and fails if a test still carries the ID. A ⊘ row's Test cell must start with `**Dropped YYYY-MM-DD**` and a reason. ⊘ (like 🖐) goes only in a Type cell; to drop a row in a table without a Type column, add the column first. `check-ids --all` gates every `## Phase <n>` heading, so a new phase's table lands in the same PR as its first tests

---

## Phase 0: Scaffold
| ID | Type | Test |
|---|---|---|
| T0.01 | U | `packages/core` exports a version string; the Vitest harness runs |
| T0.02 | U | `packages/ai` builds and exports `LLMProvider` types (type-level test via `expectTypeOf`) |
| T0.03 | U+E | Built `manifest.json` has exactly the permissions from ARCHITECTURE §10, no `content_scripts`, has `side_panel`, and CSP includes `wasm-unsafe-eval`; no `optional_permissions` and no `debugger` anywhere, in the normal build (U) and the e2e build (E, SPC-44) |
| T0.04 | E | Extension loads in Chromium with no service-worker errors |
| T0.05 | E | Side panel page renders the app shell (heading visible) |
| T0.06 | E | Options page renders |
| T0.07 | U | `LICENSE` is MIT and `package.json` license fields are `MIT` |
| T0.08 | 🖐 | `pnpm dev` launches Chrome with HMR; CI workflow green on the PR |

## Phase 1: Extraction engine
**Schema & color (U)**
| ID | Test |
|---|---|
| T1.01 | `RawPage` and `DesignScan` zod schemas parse valid fixtures and reject missing required fields; v4 rejects a non-`#rrggbb` hex and a role id outside its palette; v1–v3 rows are repaired (idempotent, input not mutated); every fixture, merge, compose and derived variant passes v5 with no repair or trim; v5 bounds every string, array and record (`BOUNDS`): a v5 scan over a bound is rejected, a v4 one is trimmed once (idempotent, roles kept valid), and merge/compose/extract clamp their output |
| T1.02 | `parseColor` handles hex/rgb/rgba/hsl/oklch/`color()`/named/`transparent` → normalised value |
| T1.03 | `contrast('#000','#fff') === 21`, `contrast('#777','#fff') ≈ 4.48` |
| T1.04 | `deltaE2000` matches reference pairs (Sharma test data subset) within 0.01 |
| T1.05 | Alpha composite: `rgba(0,0,0,.5)` over white → `#808080` (±1) |
| T1.06 | Clustering merges `#f9f9f9/#fafafa/#fbfbfb` into one token, keeps `#5e6ad2` and `#6e79d6` separate when weights warrant, caps at 24 |

**Sampler (E, runs on `fixtures/pages/*`)**
| ID | Test |
|---|---|
| T1.07 | Sampler returns ≤ 4000 samples, skips hidden/zero-area/script/style nodes, completes < 300 ms on `landing-basic.html` |
| T1.08 | Root CSS custom properties captured (fixture declares `--brand: #5e6ad2`); the variable filter (design names, values ≤ 200 chars, ≤ 200 entries) is exported for imports |
| T1.09 | `@media` breakpoints captured (fixture: 640, 768, 1024, 1280) |
| T1.10 | Section candidates: `landing-basic.html` yields 8 top-level sections |
| T1.11 | `scan.run` returns a RawPage + JPEG screenshot data URL for the active tab |
| T1.12 | Cross-origin stylesheet without permission → warning recorded, scan still succeeds |

**Extractors (U, ground truth from `fixtures/pages/*.expected.json`, plus snapshots of `fixtures/raw/*`)**
| ID | Test |
|---|---|
| T1.13 | Color roles: background, surface, textPrimary, textSecondary, accent, accentForeground, border within ΔE < 3 of expected |
| T1.14 | CSS var hint overrides the heuristic accent and sets `sourceVar` |
| T1.15 | Semantic colors (success/warning/danger) detected when present, absent otherwise |
| T1.16 | Typography: body size/weight/lineHeight, h1–h3 sizes exact; display family ≠ body family on `landing-serif.html` |
| T1.17 | Font source detection: google / self-hosted / system |
| T1.18 | Scale ratio ≈ 1.25 on the modular-scale fixture; `null` on an irregular one |
| T1.19 | Spacing base unit = 8 (`landing-basic`), 4 (`dense-app`) |
| T1.20 | Section padding Y within ±8px of expected |
| T1.21 | Radii: button/card/input medians exact; `pillButtons` true on the pill fixture |
| T1.22 | Shadows deduped and levelled 1–3 |
| T1.23 | Container max width = 1200 (±8), breakpoints sorted and deduped |
| T1.24 | Section classifier: nav, hero, logos, features, pricing, faq, cta, footer at ≥ 7/8 correct on `landing-basic` |
| T1.25 | Density classification compact / comfortable / airy on three fixtures |
| T1.26 | `extract()` output validates against the `DesignScan` schema for every fixture (property-style loop) |
| T1.27 | Snapshot: `extract()` on linear / stripe / ramp / cal raw fixtures is stable (reviewed snapshots) |
| T1.28 | Performance: `extract()` < 200 ms on the largest raw fixture |

**UI**
| ID | Type | Test |
|---|---|---|
| T1.29 | C | Palette view renders swatches + role labels; click copies hex |
| T1.30 | C | Type scale renders each style with size/weight labels |
| T1.31 | C | Blueprint lists sections in order with kinds |
| T1.32 | E | Click Scan on a fixture page → Inspect shows the expected accent hex |
| T1.33 | E | Grid overlay toggles on/off; the page's computed styles are unchanged (shadow DOM isolation) |
| T1.34 | E | Inspector hover streams the element's styles to the panel |
| T1.35 | 🖐 | Scan linear.app, stripe.com, ramp.com, cal.com: roles and type look right (screenshots in the PR) |
| T1.36 | 🖐 | Eyedropper pick → nearest token shown |
| T1.37 | C | A failed scan after one that worked (SPC-38): the old card stays but is labelled "Previous scan: <host>. The last scan failed." (`data-stale`, a region named by that label), the alert says on its own line that the card below is the previous scan (also after an unmapped error), the card's buttons read "Scan this page" and "Generate prompt (previous scan)"; its Add another page still merges into the previous scan's id; a background failure (timeout) labels it too; Alt+Shift+C whose scan fails lands on Scan with the alert and label (one that works stays on Generate); a retry that works shows the new scan with no label; no label while the retry runs; a failure with no earlier scan shows the alert alone; an unsaved previous scan keeps its "Not saved to Library" line; opening a Library scan clears the label |
| T1.38 | C+E | Inspect's Port listener (SPC-27). C: the overlay's Port connecting during `overlay.set` (the real order) is read; a foreign Port (`council`, `llm`, unnamed) or another tab's `inspector` Port is ignored, never read or disconnected; only the overlay's `inspector.hover` payload renders (malformed ones dropped, last hover stays); a disconnect mid-stream, toggle off or unmount removes only our listeners (onConnect first, one throwing removal doesn't stop the rest, never `disconnect()`), late posts are dropped, the card resets, and toggle off / unmount send `overlay.set {inspector:false}`; a failed `overlay.set` leaves no listener; a double click sends once. E: with the panel's real Inspect on, a `council` Port from another page still reaches its host page (no sender `onDisconnect`); the real Inspect button streams hovers to the card, again after leaving and re-entering the view |

## Phase 2: Outputs
| ID | Type | Test |
|---|---|---|
| T2.01 | U | Prompt (generic) contains every role hex, the body + heading sizes, base unit, radii and the section list |
| T2.02 | U | Each target (`claude-code`, `cursor`, `v0`, `lovable`) produces distinct wording and stack hints; snapshot |
| T2.03 | U | **Ethics guardrail**: prompt never contains the site host/brand name, `title`, or heading snippets (fixture with brand text); DESIGN.md drops brands in camelCase, digit-suffixed and run-together CSS variable names (short brands only at boundaries); host forms (subdomain, `WWW.`, `.co.uk`, port, title-only) and the branded-font placeholder; brands spelled with ß, İ/ı, accents, decomposed marks or fullwidth/ligature forms are matched on a folded skeleton in every generator and the stream sanitizer, removing exactly the original characters, with the B1 hex/unit cases kept on that path (SPC-31) |
| T2.04 | U | Prompt length 800–1500 tokens (approx. tokenizer) on all raw fixtures |
| T2.05 | U | DESIGN.md has a table for colors, type, spacing, radii, shadows, layout; parses as valid Markdown (remark). A backslash run before `\|` in a value never splits a table cell, under micromark's GFM table parser and a model of GitHub's (cmark-gfm) cell rules: plain text reads back exactly, a code cell shows the run doubled (SPC-36) |
| T2.06 | U | Tailwind v4 `@theme` output compiles with `@tailwindcss/node`; utility `bg-accent` resolves to the accent hex |
| T2.07 | U | Tailwind v3 config is valid JS exporting `theme.extend` |
| T2.08 | U | CSS vars output parses (postcss) and defines every role |
| T2.09 | U | shadcn theme defines all required shadcn variables in oklch |
| T2.10 | U | DTCG JSON validates against the DTCG schema; Figma JSON matches the variables import shape |
| T2.11 | U | Generators are pure: same scan in → byte-identical output |
| T2.12 | C | Generate view: format/target pickers update the preview; Copy writes the exact output to the clipboard (mocked) |
| T2.13 | E | Download produces a file with the right name and MIME |
| T2.14 | E | Alt+Shift+C opens the panel, scans, and shows Generate |
| T2.15 | 🖐 | **Dogfood**: linear.app prompt → Claude Code builds a page → "same family" judgement with screenshots |

## Phase 3: AI layer
| ID | Type | Test |
|---|---|---|
| T3.01 | U | Provider registry: register/get/list; default provider = none |
| T3.02 | U | `openaiCompat` builds the correct request (URL, headers, body) for OpenAI, OpenRouter, Groq, Ollama presets and a custom base URL; parses SSE stream (mocked fetch) |
| T3.03 | U | `anthropic` sends `anthropic-dangerous-direct-browser-access`, parses SSE events |
| T3.04 | U | `gemini` uses the `x-goog-api-key` header, parses the stream |
| T3.05 | U | Error mapping: 401 → "invalid key", 429 → "rate limited", network → "offline"; every message is fixed text, and no error (message, string, stack, JSON, cause) holds any 8+ character piece of the key, for any status, body shape, mid-stream error event or thrown fetch error (adapters + `listModels`); `scrubLegacyProviderText` cleans pre-SPC-16 stored text |
| T3.06 | U | Abort signal stops streaming in every adapter, including `chromeBuiltin` (stubbed `LanguageModel`: each `status()` state, `unsupported`, abort before and during the stream, `destroy()` once, a throwing `destroy()` never masks the result) |
| T3.07 | U | `polishPrompt` rejects model output missing any token value and falls back to the original A rewrite cut off at the length limit keeps the original with that reason (SPC-34). |
| T3.08 | U | `ask()` system prompt includes compact scan JSON; page snippets wrapped in `<page_data>` A reply that fails mid-way reports its whole sanitized text once more before the error (SPC-34). |
| T3.09 | U | Prompt-injection fixture ("ignore previous instructions…" in page text) stays inside `<page_data>` and is truncated |
| T3.10 | U | API keys: encrypted round-trip with passphrase; never written to `storage.sync`; never present in any logged string (spy on console) |
| T3.11 | U | `llm` Port protocol: load → progress… → ready; chat → delta… → done; abort (mock engine). Abort and disconnect are per Port and per id (SPC-18): aborting a queued chat leaves the running one whole, a stopped chat ends `error aborted` (never `done`), a cut-short stream ends in `error`, a closed Port's chat stops so the next Port starts, a load is not cancelled; errors while stopping never stall the queue; delete/no-GPU errors (also `requestAdapter` null or throwing, SPC-21). A worker crash, unload or delete during a load rejects every waiter (SPC-35), a dead load's late progress is ignored, two loads sent together share one worker, and the options card offers a retry that works A stream that ends at the length limit sends `done{truncated:true}` (a stop still wins), the client rejects with `TRUNCATED_TEXT` after the deltas, and a council whose summary is cut off over the in-page Port ends `error` with no verdict (SPC-34). |
| T3.12 | C | Ask view disabled with a setup hint when no provider; enabled with the mock provider and streams text An answer cut off at the length limit shows its text and the cut-off line and stays out of history, live and after a reload (SPC-34). |
| T3.13 | C | Options → API keys add/test/remove flows (mocked provider). Host access refused or the request throwing (SPC-21, the deny-capable chrome stub): Save says the browser did not grant access and the key is still in `storage.local` only; Test says so and still works; a granted origin is not asked again |
| T3.14 | E | With the mock provider injected, Ask returns a streamed answer in the side panel |
| T3.15 | 🖐 | Gemma downloads with progress, survives closing the side panel, then works **offline** (network disabled) |
| T3.16 | 🖐 | Real-key smoke test: OpenAI, Anthropic, Gemini, OpenRouter, Ollama |
| T3.17 | C | No WebGPU → clear fallback message: `navigator.gpu` missing, no adapter, or `requestAdapter` throwing each show their message with Download disabled (SPC-21; the real-browser check with WebGPU disabled goes in the PR description) |
| T3.18 | U | Critique panel (SPC-22 spike): every turn's system prompt has the persona brief, the page-data rule, and the contrast pairs (capped, before) + compactScan in one `<page_data>`; injection text stays inside it |
| T3.19 | U | Critique panel: default 3 reviewers × 2 rounds + 1 summary in order; the cap (2–3 reviewers, 1–3 rounds) is enforced in the engine |
| T3.20 | U | Critique panel: Stop mid-stream, before start, or by a stream that ends quietly on abort → turn and run `stopped`, no further call or summary |
| T3.21 | U | Critique panel: a provider error mid-round ends the run with a fixed per-kind message (never the provider's text); a rate limit is retried up to 3 times after cancellable waits; known free-tier TPM limits (Groq) pace calls; a stalled stream times out; an empty reply is marked `empty` A reply cut off at the length limit (`TRUNCATED_TEXT`) ends the run with its own fixed text, no retry and no verdict (SPC-34). |
| T3.22 | U | Critique panel: the brand sanitizer runs on every turn (snapshots, transcript, next request) and keeps measured values; an emptied turn is `filtered`; a brand spelled with ß, İ, accents or fullwidth letters is gone from every turn and the verdict (SPC-31) |
| T3.23 | U | Critique panel: a human message queued mid-turn reaches the next reviewer (clipped) without adding calls |
| T3.24 | U | Critique panel: the transcript fits the context budget, keeping the newest turns and the latest human message |
| T3.25 | ⊘ | **Dropped 2026-10-15** (replaced by T3.29 / T3.33, SPC-24): ~~Critique panel: `parseKeepChange` reads lenient keep/change lists and rejects prose~~ |
| T3.26 | ⊘ | **Dropped 2026-10-15** (replaced by T3.29 / T3.33, SPC-24): ~~Critique view: flag `flags.critique === true` gates the tab (bad values / storage error = off); no provider → Ask's setup hint; cap line; run, steer; Stop, a scan change, the flag turned off, or a provider/key switch mid-run all stop the calls (mock provider)~~ |
| T3.27 | 🖐 | Owner: critique panel on 2–3 real sites with Groq (BYOK) in a dev build; go / no-go comment on SPC-22 |
| T3.28 | U | Council (SPC-24): the user's goal reaches every call's user message as `[Goal]`, outside `<page_data>`, clipped to 1000 chars without control characters; the system prompt is identical with or without it; it survives budget trimming |
| T3.29 | U | Council: `parseVerdict` reads a lenient verdict / works / change / disagreed report and rejects prose; it parses sanitized text (brand gone, measured values kept) |
| T3.30 | U | Council host (offscreen): a run is stored once per turn end and ends `done` with a verdict; a closed panel (Port posts throwing) or a throwing `onTurn` never breaks it; a second panel attaches to the live run; one run per extension; the store keeps the newest 5 |
| T3.31 | U | Council stop paths: `stop{runId}`; the SW's `halt{at}` with no panel open (it stops a run whose settings read `resolvedAt` ≤ the change; a start older than the last halt is rejected), during a retry wait or while the provider is still being built; the SW guard halts on flag off (and forgets stored runs), a provider change or any key change / lock (not on download-list changes); badge cleared on start, ✓ / ! on finish (none if already seen), cleared when seen |
| T3.32 | U | Council failures: a provider error → fixed text, no verdict; malformed / wrong-version / unsupported-provider starts are `rejected` with nothing stored or called; the key never appears in any host message, record or SW notice; failing writes never break a run, and a run whose final write failed is still shown (and stored) on reopen; a dead host shows `interrupted` (no offscreen document, unknown run, no answer, a crash after stored turns, browser start / install), conditionally; a late answer still wins |
| T3.33 | C | Ask + council view: flag-gated mode switch (bad values / storage error = off); no provider → setup hint; goal box limit and privacy line; a full run shows thinking, then a verdict-only report with "Show discussion" closed; the mascot turns happy when done and a click opens the verdict; Stop; a verdict for another scan is labelled; rejected starts show fixed text (mock provider, in-memory Port to a real host) A cut-off turn shows its partial text above its error, with no verdict report (SPC-34). |
| T3.34 | 🖐 | Owner (SPC-24): in the branch build with Groq, give a goal, run the council, close the panel (also during a pacing wait), see the mascot / badge change when done, reopen to read the verdict, open "Show discussion"; go / no-go comment on SPC-24 |
| T3.35 | U | Vibe (SPC-33): the producer clamps a looping model's output to `BOUNDS` (summary, keyword count and length) so it passes the v5 schema; only a bounded slice is sanitized and a split trailing word is dropped (a brand fragment never survives; a one-word reply fails closed as filtered) and the final cut is sanitized again (a longer word cut to a brand never survives); no surrogate pair is split (also on the non-JSON fallback); keywords the filter empties don't shrink the list, non-string keywords are dropped, repeats are removed |
| T3.36 | C | Vibe card (SPC-33): a Library write that fails keeps the vibe shown and says "Vibe not saved to Library: …"; a save that works shows no error; failures are also toasted, so one after Inspect unmounted (a tab switch) or after the panel moved to another scan is still reported (no inline line on the other scan); a vibe finished after a scan switch is saved to its own scan, not shown; a remounted card stays busy during the model call (no second run); a save that never settles doesn't keep the button busy; a looping model's vibe saves through the real `updateScan` |
| T3.37 | U, C | Local Gemma load vs unload/delete races (SPC-37): an unload or delete that lands before a load has made its Worker (waiting on the GPU check, behind another model's load, or before the load body's first tick) cancels it at once with an error, no Worker and no model resident; a delete of another model doesn't; a load sent during a delete waits for it (and for a second delete, or a failed one), then loads cleanly; a crash in the load ahead lets a queued load go on; a load outlives its closed Port; `status.loading` counts a waiting load only for its own model; each load gets one outcome and the host ends idle. Options card: while a delete runs, Download, Delete and the model choice are off, and a failed delete restores the state before it |
| T3.38 | C | Vibe card (SPC-40): stall timeouts as in the council (`VIBE_TIMEOUT_MS` 120 s to the first text, `VIBE_GAP_MS` 30 s between pieces). A vibe() that never settles (a provider that ignores its signal) returns the card to idle with an inline error and aborts the signal; a provider that honours the abort still shows the timeout text; text that stops mid-reply times out after the gap, while slow but steady text past 120 s in total is shown; a late reply after the timeout is neither shown nor saved, and a second run started after it is; a card remounted during the hang is busy, then shows the error; a timeout while Inspect is closed is toasted and shown when the card comes back (only on its own scan); a visible card gets no duplicate toast; a reply in time leaves no timeout error |

## Phase 4: Library, Compose, Themes
| ID | Type | Test |
|---|---|---|
| T4.01 | U | Dexie (fake-indexeddb): save/get/list/delete scans; thumbnails stored separately; a stored v3 row with an unreadable color lists repaired and generates; a scan and its thumbnail are saved both or neither; writers store the parsed scan (no unknown keys) |
| T4.02 | U | Export `.specimen.json` → import round-trips identically; import runs schema migrations |
| T4.03 | U | Import rejects malformed or oversized files with a clear error; a v4 scan with a non-hex color or a dangling role is skipped, an older one is imported repaired; only export version 1 is accepted; a failed write mid-import stores nothing, the retry stores each scan once and a re-import adds nothing; imported CSS variables pass the extractor filter |
| T4.04 | U | Compose: colors from A + type from B → valid DesignScan with A's palette and B's styles |
| T4.05 | U | Compose contrast fix-up: when accentForeground on the new background fails AA, it's adjusted to pass |
| T4.06 | U | Theme derivation: dark counterpart passes AA for textPrimary/background and textSecondary/background |
| T4.07 | C | Library search filters by host/title/tag; a card edit that cannot be stored shows an error and keeps the old value |
| T4.08 | E | Scan → appears in Library after a panel reload. Unit variant (`scanSave.test.tsx`): a failed Library save keeps the scan and shows "Not saved to Library" |
| T4.09 | E | Compose two scans → Generate shows the mixed prompt |
| T4.10 | C | Side panel reopen restores the last scan of the active page (session memo per window, else a Library scan of the same page ≤ 24 h), its tab and its Ask history (a Library or composed scan keeps its origin); a different page, a memo older than 24 h or from another build, a stale scan, an empty or failing Library, a deleted scan, failing session storage, another window and a scan started meanwhile restore nothing stale; an unknown page offers the last scan without applying it |
| T4.11 | U | One-time scrub of stored Ask history: known keys (verbatim, URL-encoded) leave error and assistant text, key shapes leave error text only, real answers and user text stay; marker set once and a re-run is a no-op; a write failing halfway leaves every row unchanged with no marker; a locked key withholds the marker; a malformed row is skipped; chat reads wait for the scrub; no key is logged. Limit: a rotated key in a format with no known shape is not found |
| T4.12 | C | Library card Delete (SPC-39): every card shows a "Delete <title>" button without opening a menu; confirm removes the scan, its thumbnail and its chat, toasts "Deleted …" and moves focus to the card now in its place; the confirm shows the page title as plain text; cancel keeps everything; a failed delete shows and toasts "Could not delete that scan: …" and keeps the scan, thumbnail and chat rows; deleting the open scan sets it to unsaved (`origin: tab`, a save error), deleting another leaves it alone; the ⋯ menu's Delete, Favorite, Tags, Rename and Check still work; opening focuses the first item, arrows / Home / End move, Escape closes and refocuses ⋯, focus leaving the card row closes it; a deleted selected scan leaves the Export count |
| T4.13 | E | Library ⋯ menu not clipped (SPC-39): at a 320×520 panel with three cards (left column, right column, last row), each card scrolled to the bottom of the viewport, opening ⋯ focuses its first item and, with no manual scroll, every item is fully in the viewport and inside it horizontally, `elementFromPoint` at its centre hits it, and no box between the menu and the page scroller is scrolled; Escape refocuses ⋯; the card's Delete with the dialog accepted leaves two cards and two stored scans |
| T4.14 | U, C | Two open side panels (SPC-43): every Library write (`saveScan`, `updateScan` rename/tags/favourite, `replaceStoredScan`, `importScans`, `deleteScans`, `saveCompose`) sends one data-free `library-changed` ping after it commits; a write that throws, a missing row or a duplicates-only import sends none; a failing ping never fails the write; a burst calls back once, foreign messages are ignored, unsubscribe closes the channel. Two `<Library/>` instances: a delete, rename, favourite or new scan in one shows in the other; a rename being typed in one survives a write elsewhere (same input, text and focus, nothing committed early); a burst of pings leaks no thumbnail URLs and keeps unchanged ones, and unmount closes the channel. Lens B r1: leaving an unchanged rename or tags edit never undoes a change made in the other window; an older re-list that finishes last never replaces a newer one; a failed re-list keeps the cards (a failed first load shows the alert until a re-list works); in Compose, a picked or base scan deleted elsewhere falls back, says so, and is never saved as a source |

## Phase 5: Differentiators
| ID | Type | Test |
|---|---|---|
| T5.01 | U | Component detection: primary/secondary button, input, card clusters found on `components.html` |
| T5.02 | E | Hover/focus state styles captured from CSSOM (fixture button hover color) |
| T5.03 | U+E | Mobile capture with no `debugger` (SPC-44). U: a popup ≤ 480px is stored with its real width, a wider one throws `MobileTooWideError` after one sample and closes the popup (480 in, 481 out); the card shows "not captured" with no permission button; nothing reads `chrome.debugger` or asks for a permission. E: an independent oracle opens its own 390×844 popup and reads its width; the scan must match it (≤ 480 → `variants.mobile` with that width and a blueprint, else none and "too wide"); under CI the oracle must be ≤ 480, so CI always drives the capture. The test runs with real window sizes (Playwright's default viewport would make every popup report 1280px). Outside CI the oracle may pick the too-wide branch on a host that keeps popups wide, so a local green there does not verify mobile capture |
| T5.04 | E | Dark capture records `variants.dark` palette on `dark-mode.html` |
| T5.05 | U | a11y matrix: correct ratios and AA/AA-large flags; suggests a passing variant for failing pairs |
| T5.06 | U | **Diff**: scan vs itself = 100; changed accent lowers the color facet score; every delta listed |
| T5.07 | U | Diff fix-prompt lists concrete expected-vs-actual values |
| T5.08 | U | Multi-page merge: weights summed, roles stable, `meta.pages` recorded |
| T5.09 | E | Diff view: pick a source scan, scan the current tab, show score + deltas |
| T5.10 | 🖐 | End to end: linear.app → Claude Code build on localhost → Diff ≥ 80 after one fix round |
| T5.11 | U | Mobile capture in full screen (SPC-25, SPC-44): the scanned tab's window (else the current one) is checked first; full screen opens no window or tab and never samples the user's tab, automatic or on "Try again"; each skip has its reason and note (full screen, opened as a tab); a window or tab Chrome hands back is caught after create and only what was created is closed (the one new tab, never the user's window or other tabs); a closed panel's popup is closed on the next start and a legacy `mobile.emulatingTab` record is cleared with no debugger call; no second capture while one runs |
| T5.12 | U | `waitForTabLoad` (SPC-28): resolves whether `complete` arrives before, during or after the listener attaches, or is never delivered (the tab is re-read, one read at a time); the initial about:blank or a pending navigation is not the loaded page, including the hidden url Chrome gives about:blank when we have host access for the target (no `tabs` permission); a navigation that ends where we can't see the page (a download, a redirect to an origin without host access) stops the wait in ~2 s and is left to the scan's own error; rejects with a clear error on timeout or when the tab is closed (event or `No tab with id`); afterwards no listener, timer or read is left |
| T5.13 | U | Dark/light capture with no permission (SPC-44): a class switch that changes the page is measured and attached; one that didn't apply or left the page the same stores nothing; a page with only `prefers-color-scheme` rules shows "follows your system setting · not measured" with no capture control and samples nothing; only `theme` is ever sent; a stray `emulate` opt sent to the real background `scan.run` handler is ignored (a normal sample, no error, no `chrome.debugger`) |
| T5.14 | U | `rescanUrl` (SPC-45): on any failure (timeout, the tab closed, a scan error) it closes the tab it opened, once, and only that id; a close that fails (already closed, or any other error) never replaces the original error; success, or a failed Library save, leaves the tab open; no tab id from `create` closes nothing. A page still `loading` at the limit whose navigation has committed to a url we can see, for at least 5 s, is scanned as it is (`scanIfCommitted`, re-scan only, settled through the same cleanup); pending, blank, hidden or committed later than that still fails; only this tab's own reads and events count, and a read issued before an event can't overwrite it. The page's answer is bounded (20 s): one that never answers rejects with the timeout text, closes the tab, and a late answer is never saved; a slow save after the answer is not cut off |

## Phase 6: MCP & release
| ID | Type | Test |
|---|---|---|
| T6.01 | ⊘ | **Dropped 2026-10-09** (MCP bridge cut from v1; see IMPLEMENTATION.md Phase 6, SPC-10): ~~MCP server exposes `list_scans`, `get_scan`, `get_prompt`, `get_tokens` with valid schemas (SDK in-memory transport)~~ |
| T6.02 | ⊘ | **Dropped 2026-10-09** (MCP bridge cut from v1; see IMPLEMENTATION.md Phase 6, SPC-10): ~~WS bridge binds to 127.0.0.1 only; rejects connections without a pairing token~~ |
| T6.03 | ⊘ | **Dropped 2026-10-09** (MCP bridge cut from v1; see IMPLEMENTATION.md Phase 6, SPC-10): ~~Pushed scans are queryable via MCP tools~~ |
| T6.04 | ⊘ | **Dropped 2026-10-09** (MCP bridge cut from v1; see IMPLEMENTATION.md Phase 6, SPC-10): ~~Extension pairs with a locally running bridge and pushes a scan~~ |
| T6.05 | ⊘ | **Dropped 2026-10-09** (MCP bridge cut from v1; see IMPLEMENTATION.md Phase 6, SPC-10): ~~`claude mcp add specimen -- npx specimen-mcp` → Claude Code lists and reads scans~~ |
| T6.06 | 🖐 | Store package: zip builds, manifest validated, privacy policy present |
| T6.07 | U | Secret scan (gitleaks) on the whole history is clean (`pnpm secrets`, in the gate; skipped with a warning locally without gitleaks, required in CI) |

## Phase 7: Website & video
| ID | Type | Test |
|---|---|---|
| T7.01 | E | Website builds; all internal links resolve; Add-to-Chrome + GitHub links present |
| T7.02 | E | Lighthouse ≥ 95 (performance, a11y, best practices, SEO) via `@lhci/cli`: **a CI report, non-blocking** (`lighthouse.yml`). check-ids counts T7.02 present when the report-logic tests exist; that does **not** mean ≥ 95 passed |
| T7.03 | E | Layout works at 375px with no horizontal scroll |
| T7.04 | U | Remotion compositions render (frame count = fps × duration): **runs only in the `video` CI job**, outside `pnpm gate` (which excludes `apps/video`); check-ids lists it as "outside pnpm gate" |
| T7.05 | 🖐 | Video review (length per the user's decision) |

---

## Fixtures to build (Phase 1, task 1.15)
| File | Purpose |
|---|---|
| `fixtures/pages/landing-basic.html` | 8 sections, 8px system, `--brand` var, breakpoints 640/768/1024/1280, container 1200 |
| `fixtures/pages/landing-serif.html` | Serif display + sans body, modular scale 1.25, Google font link |
| `fixtures/pages/dense-app.html` | 4px system, compact density, irregular type scale |
| `fixtures/pages/pill.html` | Pill buttons, layered shadows, semantic colors |
| `fixtures/pages/components.html` | Buttons/inputs/cards with `:hover/:focus` rules (Phase 5) |
| `fixtures/pages/dark-mode.html` | `prefers-color-scheme: dark` palette (Phase 5) |
| `fixtures/pages/injection.html` | Prompt-injection text + brand copy (Phases 2–3) |
| `fixtures/raw/{linear,stripe,ramp,cal}.json` | Captured real sites (snapshot/regression) |
Each page has an `*.expected.json` with the ground-truth values the tests assert.
