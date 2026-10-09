# Test Plan

Every phase has a test suite with stable IDs (`T<phase>.<nn>`). Test names must start with the ID so the gate can check coverage:

```ts
it('T1.09 accent role within ΔE<3 of ground truth', () => { … })
```

**Phase gate** = `pnpm gate` green **and** every ID listed for the phase is present and passing (`scripts/check-test-ids.ts` greps the test files against this document). Manual checks (🖐) are run by Opus/you, and the results go in the PR description.

Types: **U** = unit (Vitest, Node) · **C** = component (Vitest + Testing Library, jsdom) · **E** = e2e (Playwright + Chromium with the built extension) · **🖐** = manual

---

## Phase 0: Scaffold
| ID | Type | Test |
|---|---|---|
| T0.01 | U | `packages/core` exports a version string; the Vitest harness runs |
| T0.02 | U | `packages/ai` builds and exports `LLMProvider` types (type-level test via `expectTypeOf`) |
| T0.03 | U | Built `manifest.json` has exactly the permissions from ARCHITECTURE §10, no `content_scripts`, has `side_panel`, and CSP includes `wasm-unsafe-eval` |
| T0.04 | E | Extension loads in Chromium with no service-worker errors |
| T0.05 | E | Side panel page renders the app shell (heading visible) |
| T0.06 | E | Options page renders |
| T0.07 | U | `LICENSE` is MIT and `package.json` license fields are `MIT` |
| T0.08 | 🖐 | `pnpm dev` launches Chrome with HMR; CI workflow green on the PR |

## Phase 1: Extraction engine
**Schema & color (U)**
| ID | Test |
|---|---|
| T1.01 | `RawPage` and `DesignScan` zod schemas parse valid fixtures and reject missing required fields |
| T1.02 | `parseColor` handles hex/rgb/rgba/hsl/oklch/`color()`/named/`transparent` → normalised value |
| T1.03 | `contrast('#000','#fff') === 21`, `contrast('#777','#fff') ≈ 4.48` |
| T1.04 | `deltaE2000` matches reference pairs (Sharma test data subset) within 0.01 |
| T1.05 | Alpha composite: `rgba(0,0,0,.5)` over white → `#808080` (±1) |
| T1.06 | Clustering merges `#f9f9f9/#fafafa/#fbfbfb` into one token, keeps `#5e6ad2` and `#6e79d6` separate when weights warrant, caps at 24 |

**Sampler (E, runs on `fixtures/pages/*`)**
| ID | Test |
|---|---|
| T1.07 | Sampler returns ≤ 4000 samples, skips hidden/zero-area/script/style nodes, completes < 300 ms on `landing-basic.html` |
| T1.08 | Root CSS custom properties captured (fixture declares `--brand: #5e6ad2`) |
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

## Phase 2: Outputs
| ID | Type | Test |
|---|---|---|
| T2.01 | U | Prompt (generic) contains every role hex, the body + heading sizes, base unit, radii and the section list |
| T2.02 | U | Each target (`claude-code`, `cursor`, `v0`, `lovable`) produces distinct wording and stack hints; snapshot |
| T2.03 | U | **Ethics guardrail**: prompt never contains the site host/brand name, `title`, or heading snippets (fixture with brand text) |
| T2.04 | U | Prompt length 800–1500 tokens (approx. tokenizer) on all raw fixtures |
| T2.05 | U | DESIGN.md has a table for colors, type, spacing, radii, shadows, layout; parses as valid Markdown (remark) |
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
| T3.05 | U | Error mapping: 401 → "invalid key", 429 → "rate limited", network → "offline" |
| T3.06 | U | Abort signal stops streaming in every adapter |
| T3.07 | U | `polishPrompt` rejects model output missing any token value and falls back to the original |
| T3.08 | U | `ask()` system prompt includes compact scan JSON; page snippets wrapped in `<page_data>` |
| T3.09 | U | Prompt-injection fixture ("ignore previous instructions…" in page text) stays inside `<page_data>` and is truncated |
| T3.10 | U | API keys: encrypted round-trip with passphrase; never written to `storage.sync`; never present in any logged string (spy on console) |
| T3.11 | U | `llm` Port protocol: load → progress… → ready; chat → delta… → done; abort (mock engine) |
| T3.12 | C | Ask view disabled with a setup hint when no provider; enabled with the mock provider and streams text |
| T3.13 | C | Options → API keys add/test/remove flows (mocked provider) |
| T3.14 | E | With the mock provider injected, Ask returns a streamed answer in the side panel |
| T3.15 | 🖐 | Gemma downloads with progress, survives closing the side panel, then works **offline** (network disabled) |
| T3.16 | 🖐 | Real-key smoke test: OpenAI, Anthropic, Gemini, OpenRouter, Ollama |
| T3.17 | 🖐 | No WebGPU → clear fallback message |

## Phase 4: Library, Compose, Themes
| ID | Type | Test |
|---|---|---|
| T4.01 | U | Dexie (fake-indexeddb): save/get/list/delete scans; thumbnails stored separately |
| T4.02 | U | Export `.specimen.json` → import round-trips identically; import runs schema migrations |
| T4.03 | U | Import rejects malformed or oversized files with a clear error |
| T4.04 | U | Compose: colors from A + type from B → valid DesignScan with A's palette and B's styles |
| T4.05 | U | Compose contrast fix-up: when accentForeground on the new background fails AA, it's adjusted to pass |
| T4.06 | U | Theme derivation: dark counterpart passes AA for textPrimary/background and textSecondary/background |
| T4.07 | C | Library search filters by host/title/tag |
| T4.08 | E | Scan → appears in Library after a panel reload |
| T4.09 | E | Compose two scans → Generate shows the mixed prompt |

## Phase 5: Differentiators
| ID | Type | Test |
|---|---|---|
| T5.01 | U | Component detection: primary/secondary button, input, card clusters found on `components.html` |
| T5.02 | E | Hover/focus state styles captured from CSSOM (fixture button hover color) |
| T5.03 | E | Mobile capture (390px) records `variants.mobile` with a stacked hero |
| T5.04 | E | Dark capture records `variants.dark` palette on `dark-mode.html` |
| T5.05 | U | a11y matrix: correct ratios and AA/AA-large flags; suggests a passing variant for failing pairs |
| T5.06 | U | **Diff**: scan vs itself = 100; changed accent lowers the color facet score; every delta listed |
| T5.07 | U | Diff fix-prompt lists concrete expected-vs-actual values |
| T5.08 | U | Multi-page merge: weights summed, roles stable, `meta.pages` recorded |
| T5.09 | E | Diff view: pick a source scan, scan the current tab, show score + deltas |
| T5.10 | 🖐 | End to end: linear.app → Claude Code build on localhost → Diff ≥ 80 after one fix round |

## Phase 6: MCP & release
| ID | Type | Test |
|---|---|---|
| T6.01 | U | MCP server exposes `list_scans`, `get_scan`, `get_prompt`, `get_tokens` with valid schemas (SDK in-memory transport) |
| T6.02 | U | WS bridge binds to 127.0.0.1 only; rejects connections without a pairing token |
| T6.03 | U | Pushed scans are queryable via MCP tools |
| T6.04 | E | Extension pairs with a locally running bridge and pushes a scan |
| T6.05 | 🖐 | `claude mcp add specimen -- npx specimen-mcp` → Claude Code lists and reads scans |
| T6.06 | 🖐 | Store package: zip builds, manifest validated, privacy policy present |
| T6.07 | U | Secret scan (gitleaks) on the whole history is clean |

## Phase 7: Website & video
| ID | Type | Test |
|---|---|---|
| T7.01 | E | Website builds; all internal links resolve; Add-to-Chrome + GitHub links present |
| T7.02 | E | Lighthouse ≥ 95 (performance, a11y, best practices, SEO) via `@lhci/cli` |
| T7.03 | E | Layout works at 375px with no horizontal scroll |
| T7.04 | U | Remotion compositions render (frame count = fps × duration) |
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
