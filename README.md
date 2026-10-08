# Specimen (working name)

Open-source Chrome extension that measures any website's design system (colors, type, spacing, radii, layout) and turns it into an agent-ready prompt, `DESIGN.md` and design tokens. No account, no backend, no telemetry.

<!-- demo gif -->

## Features
- **Scan**: one click measures the page you are on, in your browser.
- **Inspect**: palette with roles, type scale, spacing, radii and shadows, plus a layout blueprint.
- **Overlays**: a baseline grid overlay, a live element inspector and an eyedropper on the page.
- **Exports**: an AI prompt (generic, Claude Code, Cursor, v0, Lovable), `DESIGN.md`, Tailwind v4 and v3, CSS variables, shadcn/ui theme, W3C design tokens (DTCG) and Figma variables.
- **Shortcut**: `Alt+Shift+C` scans the current page and copies the prompt (a check mark appears on the toolbar icon). `Alt+Shift+S` opens the side panel.

## Install from source
Requires Node 22+ and pnpm (`corepack enable`; the version is pinned in `package.json`).

```bash
pnpm i
pnpm build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick `apps/extension/.output/chrome-mv3`.

For development with hot reload, run `pnpm dev`, or scan a URL in a throwaway Chrome profile with `pnpm -F @specimen/extension try <url>`.

## Usage
1. Open the site you want to study and click the Specimen icon (or press `Alt+Shift+S`).
2. **Scan** the page. The first time, Chrome asks for access to the site; it is used only when you scan.
3. **Inspect** the result: colors, type, spacing, shapes, layout.
4. **Generate** the output you need, then **Copy** or **Download** it.
5. Paste the prompt into Claude Code, Cursor, v0 or Lovable, or drop the tokens into your project.

## Use with Claude Code / Cursor (MCP)
Let your coding agent read your scans and check its own builds. Everything stays on your computer.

1. **Get a token.** Build the server once (`pnpm i && pnpm build`), then run `node /path/to/specimen/packages/mcp/dist/cli.js pair`. (Once published: `npx -y @specimen/mcp pair`.)
2. **Pair Chrome.** Open Specimen's Settings, find **Coding agents (MCP)**, paste the token and click **Connect**.
3. **Add Specimen to your agent.**
   - Claude Code: `claude mcp add specimen -- node "/path/to/specimen/packages/mcp/dist/cli.js"` (published: `claude mcp add specimen -- npx -y @specimen/mcp`).
   - Cursor: add `{ "mcpServers": { "specimen": { "command": "node", "args": ["/path/to/specimen/packages/mcp/dist/cli.js"] } } }` to `~/.cursor/mcp.json` (published: `"command": "npx", "args": ["-y", "@specimen/mcp"]`).
   - `node .../cli.js config claude-code` (or `cursor`) prints these with your real path.

Then ask your agent things like "list my Specimen scans and build this page in the style of the Linear scan" or "check my build at http://localhost:3000 against that scan". Tools: `list_scans`, `get_scan`, `get_prompt`, `get_design_md`, `get_tokens` and `check_build` (needs Chrome open with Specimen paired).

Security: the bridge listens on `127.0.0.1` only, accepts only the Chrome extension's origin, and requires the pairing token (stored in `~/.specimen/config.json`, mode 0600). Scans you share are copied to `~/.specimen/scans`. Turn off **Share scans with coding agents** in Settings to stop sharing. Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#14-mcp-bridge-packagesmcp).

## Privacy
Specimen has no backend, no analytics and no telemetry. It reads a page only when you scan it (through the `activeTab` permission or the optional site access you grant), and everything stays on your device. Nothing is sent anywhere unless you configure your own AI provider or pair a coding agent (scans then go to a server on your own computer only).

## Ethics
Specimen reads visual design (measured values), not content. Generated prompts contain colors, type, spacing and layout structure only: no logos, brand names or headline copy, and they ask the agent to build something original. Use the output as inspiration, not for copying someone else's brand or text.

## Roadmap
See [docs/PLAN.md](docs/PLAN.md). Architecture is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the build plan in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Development
```bash
pnpm dev                 # WXT dev: launches Chrome with HMR
pnpm typecheck && pnpm lint
pnpm gate                # typecheck + lint + unit + build + e2e + test-ID check
```

## License
[MIT](LICENSE)
