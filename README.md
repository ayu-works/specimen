# Specimen

Open-source Chrome extension that measures a website's design system (colors, type, spacing, radii, shadows, layout) and turns it into an agent-ready prompt and a `DESIGN.md`. No account, no backend, no telemetry.

<!-- demo gif -->

## Install

**Chrome Web Store:** [Specimen](https://chromewebstore.google.com/detail/specimen/TODO) (link goes live after review).

**From source.** Requires Node 22+ and pnpm via corepack (the version is pinned in `package.json`).

```bash
corepack enable
pnpm i
pnpm build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick `apps/extension/.output/chrome-mv3`. Chrome 116 or newer is required.

## Usage
Open the side panel from the toolbar icon (or press `Alt+Shift+S`). It has five tabs.

1. **Scan.** Click **Scan this page**. The first scan asks for one-time access to sites (see [Permissions](#permissions)). The result shows a thumbnail and warnings. From here you can:
   - **Also capture mobile** (on by default): re-measures the page at phone width in a small window. If Chrome keeps that window too wide, you can grant the optional `debugger` permission to emulate a 390px phone.
   - **Dark or light mode**: if the site defines the other theme, Specimen measures it. If the site only follows your system setting, you can capture it with the optional `debugger` permission.
   - **Add another page**: open a second page of the same site in your tab and merge it into the scan.
2. **Inspect.** Palette with roles, accessibility (contrast pairs against WCAG AA), type scale, spacing, shapes (radii, shadows, borders), components and their states, and a layout blueprint. Toolbar buttons turn on a baseline **Grid** overlay, a live element **Inspect** card and an **Eyedropper** on the page.
3. **Generate.** Pick **Prompt** or **DESIGN.md**. For the prompt, pick a target: Claude Code, Cursor, v0, Lovable or generic. Optionally include the other theme. **Copy** or **Download**.
4. **Ask.** Chat about the scanned design. Needs an AI provider.
5. **Library.** Every scan is saved on your device. Search, rename, tag, favorite, re-scan, delete, export and import as JSON. **Compose** mixes facets (colors, typography, spacing, shape, layout) from different scans into a new design.

**Fidelity check.** In Generate, the card "Already built a page from this?" compares a page you built (for example `localhost:3000`) with the original and gives a prompt that fixes the differences. The Library menu has "Check a build against this" for saved scans.

The token exports (Tailwind v4 and v3, CSS variables, shadcn/ui, W3C design tokens, Figma variables) exist as generators in `packages/core`. The side panel does not offer them yet.

## Keyboard shortcuts
| Shortcut | What it does |
|---|---|
| `Alt+Shift+S` | Opens the side panel. |
| `Alt+Shift+C` | Opens the side panel, scans the current page and shows Generate. You then click **Copy**. (Copying needs a click, so the extension has no `clipboardWrite` permission.) |

If you have not granted site access yet, `Alt+Shift+C` opens the Scan tab so you can click **Scan this page**. You can change shortcuts at `chrome://extensions/shortcuts`.

## AI (optional)
Everything above works with no AI. AI adds three things: **Ask**, **Polish with AI** (rewrites the generated prompt, and the result is rejected if it changes your measured values) and a **Vibe** summary in Inspect. Pick a provider in the extension's Settings page (the AI chip in the panel header opens it). The default is None.

- **Local Gemma.** Runs in your browser on your GPU through WebLLM and WebGPU. Private and works offline once downloaded. You choose a model and click Download (one time, from Hugging Face; you can delete it later):

  | Model | Download | Notes |
  |---|---|---|
  | Gemma 3 1B | about 0.7 GB | fastest, default |
  | Gemma 2 2B | about 1.5 GB | balanced |
  | Gemma 2 9B | about 5.2 GB | best quality, needs about 6.4 GB of GPU memory |

- **Chrome built-in.** Shown only when your Chrome exposes its built-in Prompt API model.
- **Your own API key.** Presets: Anthropic (Claude), OpenAI, Google Gemini, OpenRouter, Groq, Together, Mistral, DeepSeek, xAI, Ollama (local), LM Studio (local) and any custom OpenAI-compatible endpoint. Keys are stored in `chrome.storage.local` only, can be encrypted with a passphrase, and are sent only to the provider you chose. Chrome asks for access to that provider's address when you save the key.

## Permissions
Specimen declares no content scripts and no always-on site access.

| Permission | Why | When |
|---|---|---|
| `activeTab` | Read the tab you act on. | Granted by Chrome when you use the toolbar icon or a shortcut on a tab. |
| `scripting` | Inject the sampler and overlays into the page on demand. | When you scan or turn on an overlay. |
| `sidePanel` | Show the Specimen panel. | Always (it is the UI). |
| `storage` | Settings, API keys and the shortcut hand-off. | Always. |
| `unlimitedStorage` | Library (IndexedDB) and downloaded model weights can be large. | Always. |
| `offscreen` | Host a hidden page that runs the local Gemma model in a Web Worker. | Only when you use local Gemma. |
| optional: all sites (`<all_urls>`) | Opening the panel from the toolbar does not grant `activeTab`, so scanning needs this. Also used for thumbnails and to read cross-origin stylesheets so measurements are complete. | One-time prompt on your first scan. You can revoke it at `chrome://extensions`. |
| optional: `debugger` | Emulate a phone viewport or the dark color scheme. Chrome shows a "debugging this browser" bar for a few seconds. | Only when you click a capture button that needs it. |
| optional: a provider's address | Call the API of the AI provider you configured. | When you save a key. |

Specimen reads a page only when you scan it. The code is bundled; nothing is loaded remotely. Only local model weights are downloaded, and they are data.

## Privacy
No backend, no analytics, no telemetry. Scans are saved in your browser. Page data leaves your device only if you configure an AI provider, and only to that provider when you use an AI feature. Details are in [PRIVACY.md](PRIVACY.md).

## Ethics
Specimen reads visual design (measured values), not content. Generated prompts contain colors, type, spacing and layout structure only: no logos, brand names or headline copy, and they ask the agent to build something original. Use the output as inspiration, not for copying someone else's brand or text.

## Development
```bash
pnpm i
pnpm dev                 # WXT dev: launches Chrome with HMR
pnpm build               # production build into apps/extension/.output/chrome-mv3
pnpm zip                 # store-ready zip in apps/extension/.output/
pnpm test                # Vitest, all packages
pnpm e2e                 # Playwright, loads the built extension in Chromium
pnpm typecheck && pnpm lint
pnpm gate                # everything above plus the test-ID check
pnpm capture <url>       # save a real site's RawPage into fixtures/raw/
pnpm -F @specimen/extension try <url>   # open Chromium with the built extension on a URL
```

Layout:
- `packages/core`: pure TypeScript, no `chrome.*`. Schema (zod), color math, extractors, generators, compose, diff, accessibility.
- `packages/ai`: the `LLMProvider` interface, provider adapters and the AI features.
- `apps/extension`: the WXT + React extension (background, sampler and overlay scripts, offscreen page, side panel, options).
- `fixtures`: test pages with ground-truth JSON, and captured real sites.
- `docs`: [PLAN](docs/PLAN.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [IMPLEMENTATION](docs/IMPLEMENTATION.md), [TESTING](docs/TESTING.md).

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md). Release notes: [CHANGELOG.md](CHANGELOG.md).

## License
[MIT](LICENSE)
