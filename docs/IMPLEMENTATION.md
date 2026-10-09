# Implementation Plan

> Companion to [PLAN.md](PLAN.md) and [ARCHITECTURE.md](ARCHITECTURE.md). Status: draft · 2026-10-08

## How we work
- **Opus** plans, writes the task briefs, and reviews every phase diff. **Sonnet** subagents implement the tasks (each brief points to the relevant ARCHITECTURE.md section).
- Each task ends with green `pnpm typecheck && pnpm test && pnpm lint` before the next task starts.
- One feature branch per phase (`phase-1-extraction`, …) → PR → Opus review → merge to `main`.
- **Acceptance (AC)** lines are the definition of done.

Legend: 🟦 Sonnet builds · 🟪 Opus (design/review) · 👤 needs you

---

## Phase 0: Scaffold & repo (≈ ½ day)

| ID | Task | Files | AC |
|---|---|---|---|
| 0.1 🟦 | git init, `.gitignore`, **MIT `LICENSE`** (© 2026 Ayush Mayank), `README.md` stub, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | root | First commit contains LICENSE |
| 0.2 👤🟦 | **GitHub**: install `gh`, `gh auth login` (you do this step), `gh repo create <name> --public --source . --push` | — | Repo visible on GitHub, `main` pushed |
| 0.3 🟦 | pnpm workspace: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` (strict), `biome.json` | root | `pnpm i` works |
| 0.4 🟦 | `packages/core` skeleton + Vitest | `packages/core/{package.json,tsconfig.json,src/index.ts,vitest.config.ts}` | `pnpm -F core test` passes a sample test |
| 0.5 🟦 | `packages/ai` skeleton | `packages/ai/src/{index.ts,types.ts}` | builds |
| 0.6 🟦 | `apps/extension` with WXT + React + Tailwind v4 + shadcn/ui init | `apps/extension/{wxt.config.ts,src/entrypoints/{background.ts,sidepanel/{index.html,main.tsx,App.tsx},options/…}}` | `pnpm dev` opens Chrome with the extension; clicking the icon opens the side panel showing "Hello" |
| 0.7 🟦 | Manifest per ARCHITECTURE §10, icon placeholders, action → open side panel | `wxt.config.ts`, `public/icon/*` | Permissions match the spec; no install warning beyond basics |
| 0.8 🟦 | Playwright e2e harness loading the built extension | `apps/extension/e2e/{fixtures.ts,smoke.spec.ts}` | `pnpm e2e` opens the side panel and passes |
| 0.9 🟦 | GitHub Actions CI: install, typecheck, lint, unit, build | `.github/workflows/ci.yml` | CI green on the PR |
| 0.10 🟪 | Review & merge | — | — |

---

## Phase 1: Extraction engine (≈ 3–4 days)

### 1A. Core schema & color math
| ID | Task | Files | AC |
|---|---|---|---|
| 1.1 🟦 | zod schemas `RawPage`, `RawSample`, `DesignScan` + inferred types + `SCHEMA_VERSION` | `core/src/schema/{raw.ts,scan.ts,index.ts}` | Round-trip parse of a fixture |
| 1.2 🟦 | Color utils on `culori`: parse, toHex, toOklch, ΔE2000, WCAG contrast, alpha composite | `core/src/color/{parse.ts,distance.ts,contrast.ts,composite.ts}` + tests | Known-value tests pass (e.g. #000/#fff = 21:1) |
| 1.3 🟦 | Weighted OKLab clustering (ARCHITECTURE §5 colors 1–3) | `core/src/color/cluster.ts` + tests | Near-duplicate grays merge; distinct accents stay separate |

### 1B. Content sampler
| ID | Task | Files | AC |
|---|---|---|---|
| 1.4 🟦 | DOM walker + style reader (non-default values only, caps, priority) | `extension/src/sampler/{walk.ts,styles.ts,defaults.ts}` | ≤ 4000 samples, < 300 ms on fixture pages |
| 1.5 🟦 | Root vars, `@media`, `@font-face` collection; cross-origin CSS via `css.fetch` | `extension/src/sampler/{cssom.ts}` , background handler | Vars from a cross-origin sheet are captured when permission is granted, warning when not |
| 1.6 🟦 | Section detection (DOM side: candidate blocks + bbox) | `extension/src/sampler/sections.ts` | Fixture landing page → correct section count |
| 1.7 🟦 | `sampler.content.ts` entry + `scan.run` in background (inject, collect, `captureVisibleTab` → JPEG thumbnail) | `entrypoints/sampler.content.ts`, `entrypoints/background.ts`, `src/lib/messaging.ts` | Side panel receives a `RawPage` + screenshot |
| 1.8 🟦 | `pnpm capture <url>`: Playwright script that saves a RawPage into `fixtures/raw/` | `scripts/capture.ts` | Captures linear.app, stripe.com, ramp.com, cal.com |

### 1C. Core extractors
| ID | Task | Files | AC |
|---|---|---|---|
| 1.9 🟦 | Colors → palette + roles (+ CSS var hints) | `core/src/extract/colors.ts` | Fixture ground truth: background/text/accent within ΔE < 3 |
| 1.10 🟦 | Typography → families, styles, base, ratio | `core/src/extract/typography.ts` | Fixture: body 16px, h1 correct, family source detected |
| 1.11 🟦 | Spacing → base unit, scale, section padding | `core/src/extract/spacing.ts` | Fixture with an 8px system → baseUnit 8 |
| 1.12 🟦 | Radii, shadows, borders | `core/src/extract/{radii.ts,shadows.ts,borders.ts}` | Pill buttons detected on a fixture |
| 1.13 🟦 | Layout + section classifier | `core/src/extract/{layout.ts,sections.ts}` | Fixture landing page: nav/hero/logos/features/pricing/faq/footer ≥ 80% correct |
| 1.14 🟦 | `extract(raw) → DesignScan` orchestrator + snapshot tests on the 4 real fixtures | `core/src/extract/index.ts`, `core/test/snapshots.test.ts` | Snapshots reviewed by Opus 🟪 for sanity |
| 1.15 🟦 | Ground-truth fixture pages (2–3 static HTML pages with declared tokens) | `fixtures/pages/*.html`, `fixtures/pages/*.expected.json` | Used by 1.9–1.13 |

### 1D. Side panel: Scan & Inspect UI
| ID | Task | Files | AC |
|---|---|---|---|
| 1.16 🟦 | App shell: tabs (Scan · Inspect · Generate · Ask · Library), zustand store, theme | `sidepanel/{App.tsx,store.ts,components/Tabs.tsx}` | Tabs switch; panel follows system dark mode |
| 1.17 🟦 | Scan button → progress → result header (favicon, host, thumbnail, time) | `sidepanel/views/Scan.tsx` | One-click scan of the active tab |
| 1.18 🟦 | Inspect view: Palette (swatches + roles, click-to-copy), Type scale (live specimens in the real font), Spacing ruler, Radii/shadow chips, Blueprint (section list mini-map) | `sidepanel/views/Inspect/*.tsx` | All facets render for the 4 real fixtures |
| 1.19 🟦 | Overlays: grid (container + columns + baseline), hover inspector (Port), highlight token usages | `entrypoints/overlay.content.ts`, `src/overlay/*` | Toggle from the panel; no page CSS bleed (shadow DOM) |
| 1.20 🟦 | Eyedropper (EyeDropper API) → nearest token match | `sidepanel/components/Eyedropper.tsx` | Picking a color shows the hex + matching role |
| 1.21 🟦 | e2e: scan a fixture page → Inspect shows the expected accent hex | `e2e/scan.spec.ts` | Green in CI |
| 1.22 🟪 | Review on real sites, tune heuristics, merge | — | — |

---

## Phase 2: Outputs without AI (≈ 2 days)

| ID | Task | Files | AC |
|---|---|---|---|
| 2.1 🟪 | Write the prompt template spec (sections, wording, per-target variants) | `core/src/generate/prompt/SPEC.md` | Approved by you 👤 |
| 2.2 🟦 | `prompt` generator + targets `generic, claude-code, cursor, v0, lovable` + ethics guardrail | `core/src/generate/prompt/{index.ts,targets.ts,sections.ts}` | Snapshot tests; no brand names or headline copy leak (test) |
| 2.3 🟦 | `designmd` generator | `core/src/generate/designmd.ts` | Valid Markdown; tables for every facet |
| 2.4 🟦 | `tailwind` (v4 `@theme` + v3 config), `cssvars`, `shadcn` | `core/src/generate/{tailwind.ts,cssvars.ts,shadcn.ts}` | Output compiles (test: run tailwind v4 on it in CI) |
| 2.5 🟦 | `dtcg`, `figma` | `core/src/generate/{dtcg.ts,figma.ts}` | Validates against the DTCG JSON schema |
| 2.6 🟦 | Generate view: format picker, target picker, preview (syntax-highlighted), Copy, Download | `sidepanel/views/Generate.tsx` | Copy puts the exact output on the clipboard; Download saves a file |
| 2.7 🟦 | Keyboard shortcut Alt+Shift+C (`scan-generate`): open the panel, scan, show Generate | `background.ts` | Works on any tab |
| 2.8 🟪👤 | **Dogfood test**: scan linear.app → Claude Code builds a page → judge it | — | Looks like "same family". Tune the template |
| 2.9 🟦 | README with GIF, install-from-source steps; tag **v0.1.0** | `README.md` | Release on GitHub |

---

## Phase 3: AI layer (≈ 3 days)
> **Status: implemented (code only; tests deferred to the final testing pass).** Done: 3.1 (registry; the mock provider comes with the tests, `globalThis.__specimenProvider` is the injection hook), 3.2, 3.3, 3.4, 3.5, 3.6 and 3.7 except `nameRoles` (not built; `polishPrompt`, `vibe` and the Ask view are). Untested against a real model or real keys. 3.8 (review, tag) is pending.
| ID | Task | AC |
|---|---|---|
| 3.1 🟦 | `LLMProvider` types, registry, mock provider | Unit tests use the mock |
| 3.2 🟦 | Offscreen doc + WebLLM engine + Port `llm` protocol (load/progress/chat/abort) | Gemma loads, streams tokens in a test page |
| 3.3 🟦 | Options → Models: WebGPU check, model list (Gemma 2 2B default; Gemma 3 if in WebLLM prebuilt), download progress, delete cache | Download survives the side panel closing; offline chat works |
| 3.4 🟦 | BYOK adapters: `openaiCompat` (presets + custom base URL), `anthropic`, `gemini`; streaming; error mapping | Smoke test per provider with a real key 👤 |
| 3.5 🟦 | Options → API keys: add/test/remove, optional passphrase encryption, request host permission per provider | Keys stored locally only; "Test" button verifies |
| 3.6 🟦 | Optional `chromeBuiltin` (Prompt API) provider | Hidden when unavailable |
| 3.7 🟦 | Features: `polishPrompt` (with value-preservation check), `nameRoles`, `vibe` (vision), **Ask** view chat grounded on the scan | Every feature hidden or disabled with a hint when no provider is set |
| 3.8 🟪 | Review prompts and grounding, injection hygiene; tag v0.2.0 | — |

## Phase 4: Library, Compose, Themes (≈ 2 days)
| ID | Task | AC |
|---|---|---|
| 4.1 🟦 | Dexie DB + auto-save scans + thumbnails | Scans persist across restarts |
| 4.2 🟦 | Library view: grid, search, tags, delete, re-scan, import/export `.specimen.json` | Export → import round-trips |
| 4.3 🟦 | `core/compose`: pick a facet source per scan (colors, type, spacing, radii, layout) + contrast fix-ups | Unit tests; composed scan is valid |
| 4.4 🟦 | Compose view (pick 2+ scans, facet toggles, live preview card) → feeds Generate | Mix works end to end |
| 4.5 🟦 | Themes: derive dark/light counterpart from a palette (OKLCH lightness inversion) | Generated dark theme passes AA for text pairs |
| 4.6 🟪 | Review; tag v0.3.0 | — |

> **Phase 4 status:** 4.1–4.5 implemented (code only; tests deferred to the final testing pass). `schemaVersion` is now 2 (adds `variants.light`; migration v1 → v2 is a no-op). Compose lives inside Library as a mode (no new tab); the dark/light theme is one checkbox in Generate; the counterpart is derived on demand rather than stored.

## Phase 5: Differentiators (≈ 4–5 days)
| ID | Task | AC |
|---|---|---|
| 5.1 🟦 | Component specs: detect button/input/card/nav-link/badge clusters; capture states by cloning rules for `:hover/:focus/:active` from the CSSOM | Primary button hover color captured on fixtures |
| 5.2 🟦 | Responsive capture: re-sample at 390px (via `chrome.debugger` emulation behind an opt-in, or a resized popup window) → `variants.mobile` | Mobile nav/stack detected |
| 5.3 🟦 | Dark capture: re-sample with `prefers-color-scheme: dark` emulation → `variants.dark` | Sites with dark mode yield both palettes |
| 5.4 🟦 | a11y pass: contrast matrix + accessible variant suggestions; shown in Inspect + DESIGN.md | Failing pairs flagged with a fix |
| 5.5 🟦 | **Fidelity Diff**: `core/diff` (per-facet distance → 0–100 score) + Diff view (pick source scan, scan current tab) + "fix prompt" generator | Same site vs itself = 100; obvious deltas listed |
| 5.6 🟦 | Multi-page merge: queue several URLs/tabs, merge weights, record `meta.pages` | Merged scan is stable |
| 5.7 🟪 | Review; tag v0.4.0 | — |

> **Phase 5 status:** 5.1–5.6 implemented (code only; tests deferred to the final testing pass). `schemaVersion` is now 3 (no-op migration from v2: adds the `measured` theme flag, mobile details, a11y pair roles/fix). Entry points, no new tabs: Scan result card (Also capture mobile, Dark mode line, Add another page), Inspect (Components, Accessibility, Blueprint Desktop/Mobile), Generate ("Built it? Check your build") and Library (card menu "Check a build against this"). The only permission addition is `optional_permissions: ["debugger"]`, requested at click time for the dark capture that needs media emulation. Untested in a real browser: the mobile popup window, dark capture through the debugger, states on cross-origin sheets, and Add another page.

## Phase 6: Release (open source + Chrome Web Store) (≈ 1–2 days)
MCP is **dropped from v1** (user decision 2026-10-09). The `phase-6-mcp` branch is kept for reference.

| ID | Task | AC |
|---|---|---|
| 6.1 🟦 | Open-source docs: README (store + source install, AI setup, permissions table, privacy, FAQ), CONTRIBUTING (adding a generator / provider / extractor), CODE_OF_CONDUCT, SECURITY, issue + PR templates | A new contributor can build, load and test from the README alone |
| 6.2 🟦 | Release plumbing: version 1.0.0, `homepage_url`, `minimum_chrome_version`, `pnpm zip` (WXT zip), a GitHub Action that builds the zip on a `v*` tag and attaches it to a GitHub Release | `pnpm zip` produces a store-ready zip; no `<all_urls>` host permission, no `debugger` required permission in it |
| 6.3 🟦 | Store listing kit in `store/`: listing copy (name, ≤132-char summary, description), permission justifications, single purpose, data-use disclosures, `PRIVACY.md`, promo tile 440×280, screenshot plan | Every field of the CWS dashboard has ready-to-paste text |
| 6.4 🟦👤 | Screenshots (1280×800) planned from the user's own usage captures; the user submits with their developer account | Submitted |

## Phase 7: Website (≈ 1–2 days)
The video is deferred (user decision 2026-10-09). The site goes live on **Vercel** and hosts `/privacy` for the store listing.

| ID | Task | AC |
|---|---|---|
| 7.1 🟪 | Site design: scan 2–3 reference sites with our own tool and Compose the look | Design approved 👤 |
| 7.2 🟦 | `apps/web` Astro landing page (hero demo, how-it-works, features, privacy/local AI, OSS CTA, Add to Chrome), `/privacy`, deploy to Vercel | Lighthouse ≥ 95 |
| 7.3 ⏸ | Remotion video: deferred until after launch | — |

---

## Milestone checklist
- [ ] v0.1.0: scan + inspect + exports (Phases 0–2)
- [ ] v0.2.0: local Gemma + BYOK + Ask
- [ ] v0.3.0: Library + Compose + Themes
- [ ] v0.4.0: Diff, components, responsive/dark, a11y
- [ ] v1.0.0: Web Store + open source + website

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Heuristic roles wrong on unusual sites | CSS var hints, confidence scores, manual role override in Inspect, AI `nameRoles` |
| WebGPU unavailable / low VRAM | Detect up front; offer smaller Gemma, Chrome built-in model, or BYOK |
| Large model download (1.5–3 GB) | Explicit opt-in, progress, resumable via WebLLM cache, delete button |
| Cross-origin CSS blocked | Optional host permission via background fetch; computed styles still work without it |
| Store review flags "copying sites" | Ethics guardrail, positioning as "design system inspiration", no content scraping |
| `chrome.debugger` permission scary for responsive/dark capture | Make it an optional permission requested only when the feature is used |
