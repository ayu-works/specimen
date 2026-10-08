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
│  └─ mcp/                      # (Phase 6) `npx specimen-mcp` local MCP server
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
           (Phase 6) sidepanel ── ws://127.0.0.1:7457 ──► specimen-mcp ──► coding agent
```

| Component | Responsibility | Why it lives there |
|---|---|---|
| **sampler.content** | Walk the DOM, read `getComputedStyle`, `:root` custom props, `@media`, `@font-face`, `document.fonts`, section bounding boxes → `RawPage` | Only a content script can read the live DOM |
| **overlay.content** | Grid overlay, hover inspector, highlight of a token's usages | Draws on the page; shadow root so page CSS can't leak in |
| **background** | Inject scripts with `activeTab`, capture screenshots, fetch cross-origin stylesheets the page blocks (CORS), manage the offscreen doc | Privileged APIs; short-lived and stateless |
| **sidepanel** | UI, runs `core` extraction/generation, storage, BYOK calls | Long-lived while open; heavy compute stays off the page |
| **offscreen** | WebLLM engine on WebGPU | MV3 service workers are killed when idle and side panels close. The offscreen doc keeps the loaded model alive |
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
  schemaVersion: 1; id: string; url: string; host: string; title: string;
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
  components?: ComponentSpec[];                  // Phase 5
  variants?: { dark?: Partial<DesignScan['colors']>; mobile?: Partial<DesignScan['layout']> }; // Phase 5
  vibe?: { summary: string; keywords: string[]; model: string };   // AI, optional
  a11y?: { pairs: { fg: string; bg: string; ratio: number; aa: boolean; aaLarge: boolean }[] };
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
`schemaVersion` bumps come with a migration in `core/schema/migrations.ts`. Imports and the Library run migrations on read.

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

**Performance budget:** sampling < 300 ms, extraction < 200 ms in the side panel, total scan < 1 s on typical pages, excluding the screenshot.

---

## 6. Generators (`core/generate`)
Each generator is a pure function `(scan: DesignScan, opts) → { filename, mime, content }`.

| Generator | Output | Notes |
|---|---|---|
| `prompt` | Agent prompt (≈ 800–1500 tokens) | Sections: goal, visual direction, color roles (hex), type scale, spacing/radii, layout blueprint, component rules, do/don't, "use exact values". **Targets:** `generic`, `claude-code`, `cursor`, `v0`, `lovable` (wording plus stack hints, e.g. Next.js + Tailwind) |
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
| `webllm` (default local) | Port `llm` → offscreen doc → `@mlc-ai/web-llm` `MLCEngine` | Model: Gemma (default **gemma-2-2b-it-q4f16_1-MLC**, ~1.5 GB; upgrade to a Gemma 3 build if WebLLM's prebuilt list has one, vision-capable 4B as an option). Weights cached in Cache Storage. Requires WebGPU (detect `navigator.gpu`, show a fallback message). CSP needs `'wasm-unsafe-eval'` |
| `chromeBuiltin` (optional) | `LanguageModel` (Chrome Prompt API, Gemini Nano) | Zero download where available |
| `openaiCompat` | `fetch` `{baseUrl}/chat/completions`, SSE | Covers OpenAI, OpenRouter, Groq, Together, Mistral, DeepSeek, xAI, Ollama, LM Studio. Presets fill in baseUrl; a custom URL is allowed → "any API key" |
| `anthropic` | `fetch` `api.anthropic.com/v1/messages`, SSE | Header `anthropic-dangerous-direct-browser-access: true` |
| `gemini` | `fetch` `generativelanguage.googleapis.com` streamGenerateContent | Header `x-goog-api-key` |

**AI features** (each degrades gracefully when no provider is set):
- `polishPrompt(scan)`: rewrites the deterministic prompt for flow. Must keep every token value (validated by regex after generation, falling back to the original).
- `nameRoles(scan)`: JSON mode, suggests role fixes when heuristic confidence is low.
- `vibe(scan, screenshot)`: vision models only. Returns `{summary, keywords}`.
- `ask(scan, question, history)`: grounded Q&A. The system prompt contains a compact scan JSON.
- `composeFill(scanA, scanB)`: resolves conflicts when mixing (e.g. accent contrast on the new background).

**Prompt-injection hygiene:** page text reaches the model only as short snippets inside a clearly delimited `<page_data>` block, and the system prompt tells the model to treat it as data.

---

## 8. Messaging protocol
Typed with a small helper (`apps/extension/src/lib/messaging.ts`, a discriminated union and one `send<T>()` wrapper).

| Message | From → To | Payload → Response |
|---|---|---|
| `scan.run` | sidepanel → background | `{ tabId, opts }` → `{ raw: RawPage, screenshot: string }` |
| `css.fetch` | content → background | `{ urls[] }` → `{ texts[] }` |
| `overlay.set` | sidepanel → background → content | `{ grid?: boolean; inspector?: boolean; highlight?: { tokenId, selectorHints } }` |
| `inspector.hover` | content → sidepanel (Port `inspector`) | `{ rect, styles, matchedTokens }` (stream) |
| `offscreen.ensure` | sidepanel → background | `{}` → `{ ok }` |
| Port `llm` | sidepanel ↔ offscreen | `load{modelId}` → `progress{p,text}`… `ready` · `chat{req,id}` → `delta{id,text}`… `done{id}` · `abort{id}` |
| `mcp.push` (P6) | sidepanel → ws | `{ scan }` |

---

## 9. Storage
- **IndexedDB (Dexie), db `specimen`:**
  - `scans`: `id, host, url, title, scannedAt, *tags, schemaVersion`, value = DesignScan
  - `thumbs`: `scanId → Blob` (JPEG 640px)
  - `chats`: `id, scanId, messages[]`
  - `composes`: saved mixes
- **chrome.storage.local:** settings `{ provider, model, promptTarget, theme }` and API keys (optional AES-GCM encryption with a PBKDF2-derived passphrase key). Never use `storage.sync`, because keys must not leave the device.
- **Cache Storage:** WebLLM model weights (handled by WebLLM). `unlimitedStorage` permission.
- **Export/Import:** `.specimen.json` = `{ format: 'specimen', version, scans: DesignScan[] }`.

---

## 10. Permissions & manifest (MV3)
```jsonc
{
  "permissions": ["activeTab", "scripting", "sidePanel", "storage", "offscreen", "unlimitedStorage"],
  "optional_host_permissions": ["<all_urls>"],   // only to fetch cross-origin CSS / BYOK endpoints, on request
  "side_panel": { "default_path": "sidepanel.html" },
  "content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
  "commands": { "_execute_action": { "suggested_key": { "default": "Alt+Shift+S" } } }
}
```
No `content_scripts` declared statically. Everything is injected on demand with `activeTab`, which avoids the "read all sites" install warning.

## 11. Security & privacy
- No remote code. All JS is bundled. Model weights are data.
- API keys are never logged, never sent anywhere except the chosen provider's host, and can be cleared with one click.
- Content scripts are read-only on the page. Overlays live in a closed shadow root.
- Page text in prompts is truncated and delimited (see §7).
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
