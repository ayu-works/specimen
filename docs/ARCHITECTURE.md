# Architecture

> Companion to [PLAN.md](PLAN.md) and [IMPLEMENTATION.md](IMPLEMENTATION.md). Status: draft · 2026-10-08

## 1. Principles
1. **Deterministic first.** Measurement and exports are pure functions of the page. AI only *enhances* them (naming, narrative, Q&A). Everything works offline with no model.
2. **Local and private.** No backend, no account, no telemetry. Network traffic happens only when the user opts in: the model download, or their own API provider.
3. **Pure core.** All logic that doesn't need `chrome.*` or the live DOM lives in `packages/core` and is unit-tested in Node.
4. **One schema.** `DesignScan` (zod) is the contract between extraction, storage, generators, AI, Diff and MCP. It's versioned.

---

## 2. Repository layout (pnpm workspace)

```
AI-design website/
├─ package.json / pnpm-workspace.yaml / tsconfig.base.json / biome.json
├─ LICENSE (MIT) · README.md · CONTRIBUTING.md
├─ docs/  PLAN.md · ARCHITECTURE.md · IMPLEMENTATION.md
├─ packages/
│  ├─ core/                     # pure TS, zero browser-extension deps
│  │  └─ src/
│  │     ├─ schema/             # DesignScan, RawPage (zod) + version + migrations
│  │     ├─ color/              # parse (culori), OKLab, ΔE2000, contrast, cluster
│  │     ├─ extract/            # colors.ts typography.ts spacing.ts radii.ts shadows.ts
│  │     │                      # layout.ts sections.ts components.ts index.ts (RawPage → DesignScan)
│  │     ├─ generate/           # prompt/ designmd/ tailwind/ cssvars/ shadcn/ dtcg/ figma/
│  │     ├─ compose/            # merge scans by facet
│  │     ├─ diff/               # scan vs scan → FidelityReport
│  │     └─ a11y/               # contrast matrix + accessible variants
│  ├─ ai/                       # provider interface + adapters (runs in extension pages)
│  │  └─ src/ types.ts registry.ts prompts/ providers/{webllm,chromeBuiltin,openaiCompat,anthropic,gemini}.ts
│  └─ mcp/                      # `@specimen/mcp` (bin `specimen-mcp`): stdio MCP server + local WS bridge
├─ apps/
│  ├─ extension/                # WXT + React + TS + Tailwind v4 + shadcn/ui
│  │  └─ src/entrypoints/
│  │     ├─ background.ts       # service worker: router, injection, capture, side panel
│  │     ├─ sampler.content.ts  # injected on demand (not declared for all URLs)
│  │     ├─ overlay.content.ts  # grid / inspector overlays (shadow-DOM isolated)
│  │     ├─ offscreen/          # hosts WebLLM engine (WebGPU, persistent while in use)
│  │     ├─ sidepanel/          # main React app
│  │     └─ options/            # models, API keys, preferences
│  └─ web/                      # (Phase 7) Astro landing site + Remotion video
└─ fixtures/                    # saved RawPage JSON + static test pages
```

---

## 3. Runtime components

```
┌──────────────── Chrome ──────────────────────────────────────────────────┐
│  Web page (tab)                                                         │
│   ├─ sampler.content  ── RawPage ──┐                                    │
│   └─ overlay.content  ◄── toggle ──┤                                    │
│                                    ▼                                    │
│  background (service worker): message router · scripting.executeScript  │
│    · tabs.captureVisibleTab · cross-origin CSS fetch · offscreen lifecycle│
│                     ▲                       ▲                           │
│                     │ runtime messages      │ Port "llm"                │
│  sidepanel (React) ─┘                       └─► offscreen doc (WebLLM)  │
│   ├─ core.extract(RawPage) → DesignScan                                 │
│   ├─ core.generate.* → outputs                                          │
│   ├─ Dexie (IndexedDB): scans, thumbnails, chats                        │
│   └─ ai providers: BYOK fetch() directly · local → Port to offscreen    │
│  options page: chrome.storage.local (settings, encrypted keys)          │
└──────────────────────────────────────────────────────────────────────────┘
           background ── ws://127.0.0.1:7457 ──► specimen-mcp ──stdio──► coding agent (see §14)
```

| Component | Responsibility | Why it lives there |
|---|---|---|
| **sampler.content** | Walk the DOM, read `getComputedStyle`, `:root` custom props, `@media`, `@font-face`, `document.fonts`, section bounding boxes → `RawPage` | Only a content script can read the live DOM |
| **overlay.content** | Grid overlay, hover inspector, highlight of a token's usages | Draws on the page; shadow root so page CSS can't leak in |
| **background** | Inject scripts with `activeTab`, capture screenshots, fetch cross-origin stylesheets the page blocks (CORS), manage the offscreen doc (`ensureOffscreen()`: reasons `CLIPBOARD` + `WORKERS`, never closed while a model is loaded or loading) | Privileged APIs; short-lived and stateless |
| **sidepanel** | UI, runs `core` extraction/generation, storage, BYOK calls | Long-lived while open; heavy compute stays off the page |
| **offscreen** | WebLLM engine on WebGPU, running in a dedicated Web Worker (`llm.worker.ts`) | MV3 service workers are killed when idle and side panels close. The offscreen doc keeps the loaded model alive |
| **options** | Model download manager, API key management | Full-page settings UI |

---

## 4. Data model

### 4.1 `RawPage` (content script → side panel)
```ts
interface RawPage {
  url: string; title: string; scannedAt: number;
  viewport: { w: number; h: number; dpr: number };
  doc: { w: number; h: number };
  colorScheme: 'light' | 'dark';                 // matchMedia result
  rootVars: Record<string, string>;              // :root / html / body custom properties
  mediaQueries: string[];                        // condition text of @media rules
  fontFaces: { family: string; src: string; weight?: string; style?: string }[];
  loadedFonts: string[];                         // document.fonts with status 'loaded'
  samples: RawSample[];                          // bounded, area-sorted (≤ 4000)
  sections: RawSection[];                        // top-level stacked blocks
  warnings: string[];                            // e.g. 'cross-origin stylesheet skipped'
}
interface RawSample {
  i: number; tag: string; role?: string; depth: number;
  rect: [x: number, y: number, w: number, h: number]; // page coords
  text?: { len: number; snippet?: string };      // snippet ≤ 60 chars, headings/buttons only
  heading?: 1|2|3|4|5|6; interactive?: 'button'|'link'|'input'|'select'|'textarea';
  landmark?: 'header'|'nav'|'main'|'footer'|'aside';
  section: number;                               // index into sections
  s: Partial<Record<StyleKey, string>>;          // computed styles, defaults omitted
}
```
`StyleKey` = color, backgroundColor, backgroundImage, borderTopColor/Width/Style (+ other sides only if they differ), borderRadius, boxShadow, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textTransform, padding*, margin*, gap, rowGap, columnGap, display, flexDirection, gridTemplateColumns, justifyContent, alignItems, maxWidth, width, position, opacity, transitionDuration, transitionTimingFunction.

### 4.2 `DesignScan` (canonical, stored, exported)
```ts
interface DesignScan {
  schemaVersion: 3; id: string; url: string; host: string; title: string;
  scannedAt: number; viewport: { w: number; h: number }; colorScheme: 'light'|'dark';
  colors: {
    palette: ColorToken[];                       // clustered, weight-sorted
    roles: Partial<Record<ColorRole, string>>;   // role → ColorToken.id
    gradients: { css: string; weight: number }[];
  };
  typography: {
    families: { id: string; name: string; stack: string; role: 'display'|'body'|'mono';
                source: 'google'|'adobe'|'self-hosted'|'system'|'unknown'; weights: number[] }[];
    styles: TypeStyle[];                         // the type scale
    baseSize: number; scaleRatio: number | null;
  };
  spacing: { baseUnit: number; scale: number[]; sectionPaddingY: number; contentGap: number };
  radii: { scale: { value: number; weight: number }[]; button?: number; card?: number; input?: number; pillButtons: boolean };
  shadows: { css: string; weight: number; level: 1|2|3 }[];
  borders: { width: number; colorRole?: ColorRole; weight: number }[];
  layout: {
    containerMaxWidth: number | null; gutter: number | null; breakpoints: number[];
    density: 'compact'|'comfortable'|'airy'; blueprint: Section[];
  };
  motion?: { durationsMs: number[]; easings: string[] };
  components?: ComponentSpec[];                  // Phase 5: measured base styles + :hover/:focus/:active/:disabled
  variants?: { dark?: Partial<DesignScan['colors']> & { measured?: boolean }; light?: …same…; mobile?: Partial<DesignScan['layout']> & { typeSizes?: Record<string, number>; sectionPaddingY?: number; hamburger?: boolean; viewportWidth?: number } }; // dark/light: counterpart theme (`measured: true` = captured from the page; otherwise derived in memory); mobile: captured at a phone viewport
  vibe?: { summary: string; keywords: string[]; model: string };   // AI, optional
  a11y?: { pairs: { fg: string; bg: string; ratio: number; aa: boolean; aaLarge: boolean; fgRole?: ColorRole; bgRole?: ColorRole; kind?: 'text'|'ui'; fix?: string }[] };
  cssVariables: Record<string, string>;          // filtered design-relevant vars
  meta: { extractorVersion: string; sampleCount: number; durationMs: number; warnings: string[]; pages?: string[] };
}
type ColorRole = 'background'|'surface'|'surfaceAlt'|'textPrimary'|'textSecondary'|'textMuted'
  |'border'|'accent'|'accentHover'|'accentForeground'|'link'|'success'|'warning'|'danger';
interface ColorToken { id: string; hex: string; oklch: [number, number, number]; alpha: number;
  weight: number; usage: { bg: number; text: number; border: number; fill: number }; sourceVar?: string; }
interface TypeStyle { id: string; role: 'display'|'h1'|'h2'|'h3'|'h4'|'body-lg'|'body'|'small'|'caption'|'label'|'button'|'code';
  familyId: string; size: number; weight: number; lineHeight: number; letterSpacingEm: number;
  transform?: 'uppercase'|'lowercase'|'capitalize'; weightShare: number; sample?: string; }
interface Section { index: number; kind: 'nav'|'hero'|'logos'|'features'|'stats'|'testimonials'|'pricing'
  |'cta'|'faq'|'content'|'footer'|'unknown'; y: number; height: number;
  arrangement: 'stack'|'split'|'grid'|'bento'|'carousel'|'list'; columns: number;
  align: 'left'|'center'; bgRole?: ColorRole; headingStyleId?: string; confidence: number; }
interface ComponentSpec { kind: 'button-primary'|'button-secondary'|'button-ghost'|'input'|'card'|'nav-link'|'badge';
  base: Record<string, string>; states: Partial<Record<'hover'|'focus'|'active'|'disabled', Record<string, string>>>; }
```
`schemaVersion` bumps come with a migration in `core/schema/migrations.ts`. Imports and the Library run migrations on read. v2 (Phase 4) only adds `variants.light`; v3 (Phase 5) only adds optional fields (the `measured` flag on theme variants, mobile details in `variants.mobile`, role/kind/fix on `a11y` pairs). Both v1 → v2 and v2 → v3 are no-ops that set the version. The fidelity report is never stored on a scan.

**Compose (`core/compose`).** `compose(sources: Partial<Record<Facet, DesignScan>>, base)` takes each facet (`colors`, `typography`, `spacing`, `shape` = radii + shadows + borders, `layout`) from its source, else from `base`, and returns a new valid scan (`host: 'composed'`, `meta.pages` = source URLs). After mixing it repairs contrast by moving the foreground's OKLCH lightness (`textPrimary` and `accentForeground` ≥ 4.5, `textSecondary` ≥ 3) and records each change in `meta.warnings`. In the UI, Compose is a mode inside Library, not a tab.

**Themes (`core/theme`).** `deriveCounterpart(colors)` detects the scheme from the background lightness and inverts OKLCH lightness with role-aware targets (hue kept; accent stays vivid at ≥ 3:1; `textPrimary` ≥ 7 where possible; `textSecondary` ≥ 4.5; `accentForeground` ≥ 4.5). The result is stored in memory as `variants.dark` (light source) or `variants.light` (dark source). Generate's "Include dark/light theme" option (default off, persisted) attaches it with `withCounterpart` or strips variants with `withoutThemeVariants`; the generators then emit it (prompt and DESIGN.md sections, CSS vars `[data-theme]`, Tailwind v4 `@custom-variant` + block, shadcn `.dark`/`.light`).

---

## 5. Extraction pipeline (`core/extract`)

**Sampling (content script, bounded to < 300 ms on typical pages)**
- Walk `document.body` with a TreeWalker. Skip `display:none`, `visibility:hidden`, `opacity:0`, zero-area elements, `<script|style|svg internals|noscript>`, and anything far below the fold beyond `doc.h` caps (sample the whole page, but cap at 4000 elements, prioritised by area and semantic tags).
- Emit only non-default style values to keep `RawPage` small (target < 1.5 MB).
- `rootVars`: read `getComputedStyle(document.documentElement)` for every custom property found by iterating `document.styleSheets` (same-origin). For cross-origin sheets, the background fetches the CSS text and the core parses it with a tiny tokenizer.

**Colors**
1. Parse every color value with `culori`. Composite rgba over the nearest opaque ancestor background.
2. Weights: background = visible area; text = `len × fontSize²`; border = perimeter × width; svg fill = area.
3. Cluster in OKLab: greedy by weight, merge if ΔE2000 < 2.5 (neutrals) or < 4 (chromatic). Keep ≤ 24 tokens.
4. **Role inference**
   - `background`: largest-weight bg on html/body/main or the top sections.
   - `surface` / `surfaceAlt`: next largest bgs within ΔL ≤ 0.12 of `background`, used on card-like boxes (radius > 0 or shadow or border).
   - `textPrimary`: highest text weight. `textSecondary` / `textMuted`: next text colors with lower contrast against `background`.
   - `accent`: highest-chroma (C > 0.06) color used as a bg on `interactive=button` or as a link color, weighted by count. `accentForeground` = the text color on those buttons.
   - `link`: most common color on `a` that isn't `textPrimary`.
   - `border`: most common border color with width ≥ 1.
   - `success` / `warning` / `danger`: chromatic tokens in hue bands (green 120–160°, amber 60–90°, red 15–35°) if present.
   - CSS var hints: names matching `/primary|brand|accent|bg|background|foreground|fg|muted|border|ring/` that resolve to a clustered token override the heuristics, and `sourceVar` is recorded.

**Typography**
- Group text samples by (primary loaded family, size, weight, lineHeight, letterSpacing, transform), weighted by text length.
- `body` = the heaviest group among `p, li, td, span` with len > 40. `h1..h4` come from heading tags, falling back to size rank. `display` = the largest size > 1.6 × h1 if it exists. `button` / `label` come from interactive samples.
- Family role: the family used by headings → `display`, by body → `body`, monospace generic or `code/pre` → `mono`. Source: an `@font-face` src host (`fonts.gstatic.com` → google, `use.typekit.net` → adobe, same-origin → self-hosted) or a system-stack match.
- `scaleRatio` = geometric-mean ratio of consecutive distinct sizes if their variance is low, else `null`.

**Spacing**
- Collect non-zero padding/margin/gap px values from layout boxes, weighted by element area^0.5.
- `baseUnit` = the candidate in {2, 4, 5, 6, 8, 10, 12} that maximises (weighted share divisible within ±1px) − 0.02 × (12 / candidate). Ties go to 4 or 8.
- `scale` = up to 10 peaks of the value histogram, snapped to multiples of the base.
- `sectionPaddingY` = median vertical padding of `sections`. `contentGap` = median `gap` inside sections.

**Radii, shadows, borders**
- Radii histogram (px, ignoring 50% circles on square elements). `button`, `card` and `input` medians come from the respective element classes. `pillButtons` if the button radius ≥ height / 2.
- Shadows: normalise and dedupe `box-shadow` strings, rank by weight, then assign level by blur radius.

**Layout & sections**
- `containerMaxWidth`: mode of the widths of horizontally centred blocks (|leftGap − rightGap| < 4px) narrower than the viewport, rounded to 8.
- `breakpoints`: `min-width` / `max-width` px values from `mediaQueries`, clustered and sorted, top 5.
- Sections: from `body`, descend through single-child wrappers until a level has ≥ 3 children each ≥ 80% of the viewport wide and stacked vertically. Those are the sections.
- Section `kind` classifier (scored rules, highest wins, `confidence` = margin):
  - `nav`: `header` / `nav` landmark at y≈0, height < 140
  - `hero`: first post-nav section containing the largest heading
  - `logos`: ≥ 4 imgs/svgs of similar small height in a row
  - `features`: ≥ 3 sibling card-like boxes with heading + text
  - `stats`: ≥ 3 large numerals
  - `testimonials`: blockquote / avatar + quote marks
  - `pricing`: currency symbols + repeated cards + buttons
  - `faq`: `details` / accordion or ≥ 3 question-mark headings
  - `cta`: short section, heading + 1–2 buttons
  - `footer`: `footer` landmark / last section with many links
- `arrangement` / `columns` come from `display:grid` columns or the count of horizontally aligned children.
- `density` = `sectionPaddingY / baseSize` thresholds (< 4 compact, < 7 comfortable, else airy).

### 5.1 Phase 5 additions

**Components and states.** The sampler (`sampler/components.ts`) finds buttons, inputs, nav links, card-like boxes and badges, groups instances by a style signature (fill, border, radius, font) and keeps up to three representatives of the dominant group per kind. Buttons split into `button-primary` (the most common, most colorful filled group; on monochrome sites the most contrasting), `button-secondary` (outlined, else the next filled group) and `button-ghost`. Colors are resolved through a 1×1 canvas so any CSS color syntax works. States are **read, not simulated** (`sampler/states.ts`): the CSSOM walk (plus the cross-origin text the background fetches, parsed by a small rule scanner) collects rules naming `:hover`, `:focus`/`:focus-visible`, `:active` and `:disabled`/`[disabled]`; the state is stripped from each selector and the rest is tested with `element.matches()`. Matching rules apply in specificity/source order, only visual properties are kept, and `var()` is resolved against the element's computed custom properties. `@media` blocks count only when they match the current viewport. `core/extract/components.ts` takes the per-property mode over the representatives, normalises colors to hex and drops state values equal to the base. The result is `scan.components`. Generators use it for "Component rules" (prompt) and the Components table (DESIGN.md) and fall back to the derived rules per kind.

**Mobile (`variants.mobile`).** No `debugger`: the side panel opens a temporary `chrome.windows.create({ type: 'popup', width: 390, height: 844, focused: false })`, waits for load plus a 1.5 s settle, runs the sampler with `skipComponents`, extracts with `core.extractMobile` (layout/blueprint, container, gutter, density, type sizes and section padding that differ, and whether the top bar shows a menu button) and closes the window. Browsers enforce a minimum popup width, so the real width is stored in `viewportWidth`.

**Dark / light capture (`variants.dark|light`, `measured: true`).** The sampler first reads the page's CSSOM for theme switches (`.dark`, `.theme-dark`, `[data-theme=dark]`, `[data-mode=…]`, …; escaped utility classes like `.dark\:bg-x` do not count). If one exists, the scan flow re-samples with that class/attribute set on `<html>` (the other scheme's switch removed, transitions frozen) and restores it afterwards. No permission is needed. Only when the page merely has `@media (prefers-color-scheme)` rules is the user offered "capture", which requests the **optional** `debugger` permission, attaches, sends `Emulation.setEmulatedMedia` with `prefers-color-scheme`, re-samples colors, restores and detaches (Chrome shows its "debugging this browser" bar meanwhile). A result is accepted only if it is really in the other scheme and its background differs by ΔE ≥ 8. Palette ids are prefixed `dark-`/`light-`. A measured variant replaces the derived one everywhere (Palette toggle label, Generate checkbox, prompt/DESIGN.md wording).

**Accessibility (`core/a11y`).** `computeA11y(colors)` runs at extract time: `textPrimary`, `textSecondary`, `textMuted` and `link` on `background` and `surface`, `accentForeground` on `accent` (4.5:1, large-text 3:1) and `border` on `background` (UI component, 3:1). Failing pairs get `fix` = `ensureContrast` (OKLCH lightness shift) to the required ratio. Inspect shows the summary ("9 of 11 pairs pass AA") and failing pairs with a before/after swatch; DESIGN.md has the table; the prompt adds one "adjusted colors for AA" line for failing text roles.

**Multi-page merge (`core/extract/merge.ts`).** `mergeScans(scans)` re-clusters colors from the summed usage weights (a scan that already merges n pages counts n times), maps each role to the hex most pages agree on, keeps the heavier type style per role, uses weighted modes/medians for spacing, radii and layout, unions shadows and borders by weight, keeps the first page's blueprint, components and variants, and lists every URL in `meta.pages`. The merged scan keeps the first scan's id, so the Library entry is replaced, not duplicated. Output is deterministic.

### 5.2 Fidelity check (`core/diff`)
`diffScans(source, build) → { score, facets, deltas }`. Facet weights: colors 30, type 25, spacing 15, shape 15, layout 15; the score is the weighted mean, and a scan against itself scores 100.
- **Colors:** per role present in the source, ΔE2000 → score (≤ 1 → 100, ≥ 20 → 0, linear between); a role missing in the build scores 0. Roles are weighted (background, text, accent highest).
- **Type:** body, h1 (largest of display/h1), h2, h3: size (relative error, 0 at 50%), weight, line height (50/25/25), plus heading and body family. Families match on normalised names, on the first family of the stack, or on the free alternative the prompt recommended (`generate/fonts.ts`).
- **Spacing:** base unit (equal, or a multiple), section padding (±15%), content gap (±25%).
- **Shape:** button, card and input radius (within 2px; two pill-button scans match), shadow level overlap and count, border width.
- **Layout:** container width (±5%), section-kind sequence similarity (LCS ratio over the blueprint), density.
Deltas carry `facet, item, expected, actual, severity, hint`; severity comes from the item score (lowered for low-weight items) and they are sorted by severity, then by points lost. `generateFixPrompt(report, source)` turns the top 12 into a numbered "change X to Y" prompt ("Your build scores 82/100 … Don't change anything else."), sanitised like the main prompt. The UI (Generate → "Built it? Check your build") scans the active tab with `scanTab(tabId, { save: false })`, so builds never enter the Library; Library's card menu "Check a build against this" opens the scan and scrolls to that card. Same URL as the target → "Switch to the tab with your build."

**Performance budget:** sampling < 300 ms, extraction < 200 ms in the side panel, total scan < 1 s on typical pages, excluding the screenshot.

---

## 6. Generators (`core/generate`)
Each generator is a pure function `(scan: DesignScan, opts) → { filename, mime, content }`.

| Generator | Output | Notes |
|---|---|---|
| `prompt` | Agent prompt (≈ 800–1500 tokens) | Sections: goal, visual direction, color roles (hex), type scale, spacing/radii, layout blueprint, on mobile (when captured), component rules (measured with states when available), do/don't, "use exact values". **Targets:** `generic`, `claude-code`, `cursor`, `v0`, `lovable` (wording plus stack hints, e.g. Next.js + Tailwind) |
| `designmd` | `DESIGN.md` | Full reference with tables, more detail than the prompt |
| `tailwind` | Tailwind v4 `@theme { --color-* --font-* --radius-* --spacing }` CSS | Plus a v3 `tailwind.config.js` option |
| `cssvars` | `:root { … }` + `[data-theme=dark]` | |
| `shadcn` | shadcn/ui theme CSS vars (`--background`, `--primary`, … in oklch) | Maps roles → shadcn names |
| `dtcg` | W3C Design Tokens JSON | Style Dictionary compatible |
| `figma` | Figma Variables import JSON | |

**Ethics guardrail** (all prompt generators): never include logos, brand names or headline copy. Section samples are replaced with placeholders, and the prompt adds a "build an original product inspired by this visual system; don't reproduce trademarks" line.

---

## 7. AI layer (`packages/ai`)

```ts
interface LLMProvider {
  id: string; label: string;
  capabilities: { vision: boolean; streaming: boolean; contextTokens: number };
  status(): Promise<{ state: 'ready'|'needs-setup'|'downloading'|'error'; detail?: string; progress?: number }>;
  chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<string>;   // yields text deltas
}
interface ChatRequest { system?: string; messages: { role: 'user'|'assistant'; content: string | ContentPart[] }[];
  maxTokens?: number; temperature?: number; json?: boolean; }
type ContentPart = { type: 'text'; text: string } | { type: 'image'; dataUrl: string };
```

| Provider | Transport | Details |
|---|---|---|
| `webllm` (local) | Port `llm` → offscreen doc → Web Worker → `@mlc-ai/web-llm` `WebWorkerMLCEngine` | Gemma options from WebLLM 0.2.85's prebuilt list: **gemma3-1b-it-q4f16_1-MLC** (small, default; ~0.7 GB download, 711 MB VRAM), **gemma-2-2b-it-q4f16_1-MLC** (balanced; ~1.5 GB, 1895 MB VRAM), **gemma-2-9b-it-q4f16_1-MLC** (larger; ~5.2 GB, 6422 MB VRAM). There is no vision-capable Gemma in the prebuilt list, so `vision` is false. Weights are cached by WebLLM in Cache Storage. Requires WebGPU (`navigator.gpu.requestAdapter()`; otherwise the `unsupported` error and a friendly message). **No remote code:** the model-library `.wasm` for each option is bundled in `public/models/` (fetched at build-prep time by `scripts/fetch-model-libs.mjs`) and the `appConfig` override points `model_lib` at `chrome.runtime.getURL('/models/<file>.wasm')`; only weights are downloaded at runtime. CSP needs `'wasm-unsafe-eval'`. Gemma has no system role, so the offscreen host folds the system prompt into the first user turn |
| `chromeBuiltin` (optional) | `LanguageModel` (Chrome Prompt API, Gemini Nano) | Zero download where available |
| `openaiCompat` | `fetch` `{baseUrl}/chat/completions`, SSE | Covers OpenAI, OpenRouter, Groq, Together, Mistral, DeepSeek, xAI, Ollama, LM Studio. Presets fill in baseUrl; a custom URL is allowed → "any API key" |
| `anthropic` | `fetch` `api.anthropic.com/v1/messages`, SSE | Header `anthropic-dangerous-direct-browser-access: true` |
| `gemini` | `fetch` `generativelanguage.googleapis.com` streamGenerateContent | Header `x-goog-api-key` |

**AI features** (each degrades gracefully when no provider is set):
- `polishPrompt(provider, scan, prompt)`: rewrites the deterministic prompt for flow. Must keep every hex, px value and font name (validated after generation and after `sanitize`, falling back to the original with `{ polished: false, reason }`).
- `nameRoles(scan)`: JSON mode, suggests role fixes when heuristic confidence is low.
- `vibe(provider, scan, screenshot)`: vision models only. Returns `{summary, keywords}` (zod-validated, falls back to the raw text as the summary); stored into `scan.vibe`.
- `ask(provider, scan, question, history)`: grounded Q&A. The system prompt contains a compact, brand-free scan JSON (roles + hex, type scale, spacing, radii, layout, section kinds; no snippets) inside `<page_data>`. Streaming features report sanitized running snapshots (the ethics `sanitize` pass needs whole text), not raw deltas.
- `composeFill(scanA, scanB)`: resolves conflicts when mixing (e.g. accent contrast on the new background).

**Not built yet:** `nameRoles`, `composeFill`.

**Prompt-injection hygiene:** page text reaches the model only as short snippets inside a clearly delimited `<page_data>` block, and the system prompt tells the model to treat it as data.

---

## 8. Messaging protocol
Typed with a small helper (`apps/extension/src/lib/messaging.ts`, a discriminated union and one `send<T>()` wrapper).

| Message | From → To | Payload → Response |
|---|---|---|
| `scan.run` | sidepanel → background | `{ tabId, opts? }` → `{ raw: RawPage, screenshot: string }`. `opts`: `theme` (toggle the page's own class/attribute switch), `emulate` (debugger color-scheme emulation), `colorsOnly`, `skipComponents`, `noScreenshot`. The options are handed to the sampler through `globalThis.__specimenOpts` in the same isolated world just before injection |
| `css.fetch` | content → background | `{ urls[] }` → `{ texts[] }` |
| `overlay.set` | sidepanel → background → content | `{ grid?: boolean; inspector?: boolean; highlight?: { tokenId, selectorHints } }` |
| `inspector.hover` | content → sidepanel (Port `inspector`) | `{ rect, styles, matchedTokens }` (stream) |
| `offscreen.ensure` | sidepanel → background | `{}` → `{ ok }` |
| Port `llm` | sidepanel / options ↔ offscreen | `load{modelId}` → `progress{p,text}`… `ready` · `chat{id,req}` → `delta{id,text}`… `done{id}` \| `error{id,kind,message}` · `abort{id}` · `unload` · `delete{modelId}` → `deleted` · `status{modelId?}` → `status{loaded?,loading?,p?,gpu,cached?}`. The caller sends `offscreen.ensure` first, because a Port to a missing document fails |
| `offscreen.busy` | background → offscreen | `{}` → `{ busy }`; the background closes a document it created for the clipboard only when not busy |
| `mcp.push` | library (`lib/db.ts`) → background | `{ id }` → `{ ok }`. A scan was saved or changed; the background reads it from Dexie and pushes it over the WS (no-op unless connected and sharing) |
| `mcp.delete` | library → background | `{ ids[] }` → `{ ok }`; mirrored to the server as `scan.delete` |

---

## 9. Storage
- **IndexedDB (Dexie 4), db `specimen`, version 1:**
  - `scans`: `&id, host, url, title, scannedAt, *tags`; value = `DesignScan & { tags: string[]; favorite?: boolean }`. Every successful scan is saved automatically (re-scans add a new row). Rows are read through `migrate()`. Above 500 scans the Library offers once to export and delete the oldest (never silently).
  - `thumbs`: `&scanId`; value = `{ scanId, blob }` (the 640px JPEG from the scan)
  - `chats`: `&scanId`; value = `{ scanId, messages[] }` (Ask history per scan)
  - `composes`: `&id, createdAt`; value = `{ id, name, sources: Record<Facet, scanId>, createdAt }` (the composed scan itself is also saved in `scans` with the tag `composed`)
- **chrome.storage.local:** `settings.promptTarget`, `settings.lastFormat`, `settings.includeCounterpart`, `settings.libraryCapAsked`, and `settings.ai = { provider: 'none'|'webllm'|'chrome'|'byok', webllmModel, byok: { preset, baseUrl, model, keyRef, vision? }, encryptKeys, downloaded[] }`. API keys are stored separately under `secrets.<preset>` as `{ v:1, enc:false, key }` or, with the optional passphrase, `{ v:1, enc:true, salt, iv, ct, iterations }` (AES-GCM; key from PBKDF2-SHA256, 250k iterations, one random salt shared by all encrypted keys so one passphrase unlocks them). The derived raw key (never the passphrase) is cached in `chrome.storage.session` for the browser session; the side panel asks for the passphrase once. Never use `storage.sync`, because keys must not leave the device. Keys are never logged or put in URLs (Gemini uses the `x-goog-api-key` header).
- **MCP:** `settings.mcp = { share: boolean, port: number }` and the pairing token in `chrome.storage.local` under `secrets.mcpToken` (a plain string, never logged, never in `storage.sync`). The background publishes the connection status `{ state: 'unpaired'|'connecting'|'connected'|'error', reason? }` in `chrome.storage.session` under `session.mcpStatus`; the options page only reads it.
- **Cache Storage:** WebLLM model weights (handled by WebLLM). `unlimitedStorage` permission.
- **Export/Import:** `.specimen.json` = `{ format: 'specimen', version: 1, scans: DesignScan[] }`, without thumbnails or tags. Import rejects files over 20 MB or malformed ones, migrates each scan, skips invalid ones and gives colliding ids a new id.

---

## 10. Permissions & manifest (MV3)
```jsonc
{
  "permissions": ["activeTab", "scripting", "sidePanel", "storage", "offscreen", "unlimitedStorage"],
  "optional_permissions": ["debugger"],          // requested only when the user turns on dark-mode capture that needs emulation
  "optional_host_permissions": ["<all_urls>"],   // only to fetch cross-origin CSS / BYOK endpoints, on request (each provider origin is requested via chrome.permissions.request when the user saves a key)
  "side_panel": { "default_path": "sidepanel.html" },
  "content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
  "commands": { "_execute_action": { "suggested_key": { "default": "Alt+Shift+S" } } }
}
```
No `content_scripts` declared statically. Everything is injected on demand with `activeTab`, which avoids the "read all sites" install warning.

## 11. Security & privacy
- No remote code (Chrome Web Store policy). All JS is bundled, **including WebLLM's model-library `.wasm`** (`public/models/`, referenced through the `appConfig` `model_lib` override with `chrome.runtime.getURL`). Only model weights are downloaded at runtime, and they are data. The offscreen document is created with reasons `CLIPBOARD` and `WORKERS` (fixed at creation; only one can exist).
- API keys are never logged, never sent anywhere except the chosen provider's host, and can be cleared with one click.
- Content scripts are read-only on the page. Overlays live in a closed shadow root.
- Page text in prompts is truncated and delimited in `<page_data>` with a system rule to treat it as data (see §7). Page data goes only to the provider the user chose; with none configured nothing is sent.
- A privacy policy in the store listing: "No data collected."

## 12. Testing strategy
| Layer | Tool | What |
|---|---|---|
| core | Vitest | Color math, clustering, role inference, scale detection, section classifier; snapshot tests on `fixtures/raw/*.json` → `DesignScan` + every generator |
| fixtures | Static HTML pages with *known* tokens (`fixtures/pages/`) | Ground-truth assertions (accent ΔE < 3, base unit = 8, container 1200) |
| extension | Playwright + Chromium with `--load-extension` | Scan a fixture page end-to-end, side panel renders, export downloads |
| ai | Vitest with a mock provider; manual smoke checklist for WebLLM + each BYOK adapter | |
| capture | `pnpm capture <url>` script (Playwright) saves a real site's RawPage into `fixtures/raw/` | Lets the extraction be tuned offline |

## 13. Tech stack summary
WXT · React 19 · TypeScript (strict) · Tailwind v4 · shadcn/ui · zustand · Dexie · zod · culori · @mlc-ai/web-llm · Vitest · Playwright · Biome · pnpm. Later: Astro (website), Remotion (video), `@modelcontextprotocol/sdk` (MCP).

---

## 14. MCP bridge (`packages/mcp`)

### Process model
```
coding agent ──stdio (MCP)──► specimen-mcp ◄──ws://127.0.0.1:7457── extension background (service worker)
                                  │
                                  └─ ~/.specimen/{config.json, scans/<id>.json}
```
The agent (Claude Code, Cursor) launches `specimen-mcp` as a stdio MCP server. The same process also runs the WS bridge on `127.0.0.1:<port>` (default 7457; `--port` or `SPECIMEN_PORT`). If the port is busy, another instance owns the bridge: this one logs a single line to stderr (stdout is the MCP channel) and keeps serving the scans already on disk. `check_build` only works on the instance that owns the bridge. The bundle includes `@specimen/core`, so the package is self-contained.

### Tools and resources
`list_scans {query?}` · `get_scan {id}` · `get_prompt {id, target?, includeTheme?}` · `get_design_md {id}` · `get_tokens {id, format}` (`tailwind-v4|tailwind-v3|cssvars|shadcn|dtcg|figma`) · `check_build {targetId, url}` (needs the extension connected; scans `url` in Chrome, runs `diffScans` and returns the score plus `generateFixPrompt`; 60 s timeout). Resources: `specimen://scans/{id}` (JSON) and `specimen://scans/{id}/prompt` (markdown). Everything is computed on demand from the stored `DesignScan` by `@specimen/core`.

### WS protocol (JSON text frames)
| Direction | Message | Notes |
|---|---|---|
| ext → server | `hello { token, version }` | must be the first message, within 5 s |
| server → ext | `welcome { version, scans }` | hello accepted |
| server → ext | `error { reason }` | `bad-token` (socket closed, 4401), `bad-hello`, `bad-message` |
| ext → server | `scan.push { scan, tags? }` | validated with `migrate()` and upserted to disk |
| ext → server | `scan.delete { id }` | |
| server → ext | `scan.request { reqId, url }` | ext opens `url` in a background tab, waits for load plus 800 ms, scans with `save: false` and closes the tab |
| ext → server | `scan.result { reqId, scan \| error }` | scan validated with `migrate()`; not stored |
| both | `ping` / `pong` | the extension pings every 20 s (this also keeps the MV3 worker alive); the server sends WS-level pings every 20 s and drops dead sockets |

On connect, with "Share scans with coding agents" on, the extension pushes the whole Library, then every new or updated scan and every delete. Reconnects use exponential backoff (1 s up to 30 s). While waiting, the worker calls a no-op API every 20 s so it is not stopped (no `alarms` permission needed). A wrong token is terminal until the user pastes a new one.

### Security
- The listener binds to `127.0.0.1` only. There is no other network exposure.
- Upgrades whose `Origin` is not `chrome-extension://…` are refused (HTTP 401), so web pages cannot reach it.
- The pairing token is 32 random bytes (base64url), generated on first run and stored in `~/.specimen/config.json` (mode `0600`). It is checked with a constant-time comparison (`timingSafeEqual` over SHA-256 digests) and never logged, except by the explicit `specimen-mcp pair` command. In the extension it lives in `chrome.storage.local` under `secrets.mcpToken`.
- Scan ids are restricted to `[A-Za-z0-9_-]{1,128}` before they touch the file system. Every scan is validated with `migrate()` before it is written or used. WS frames are capped at 64 MB.
- `check_build` is limited to `http(s)` URLs and needs the extension's existing `<all_urls>` optional access; without it the extension answers with an error asking the user to scan once from the side panel.

### `~/.specimen` layout (`$SPECIMEN_HOME` overrides it)
```
~/.specimen/            0700
├─ config.json          0600   { "token": "<base64url>" }
└─ scans/               0700
   └─ <scanId>.json     0600   DesignScan + { tags: string[] }
```
Disconnecting in the extension does not delete stored scans; remove `~/.specimen/scans` to clear them.
