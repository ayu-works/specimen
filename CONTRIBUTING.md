# Contributing to Specimen

Thanks for helping. Specimen is a Chrome MV3 extension that measures a site's design system; the product and design docs are in [docs/](docs/).

## Dev setup
Requires Node 22+ and pnpm (`corepack enable`; the version is pinned in `package.json`).

```bash
pnpm i
pnpm dev          # WXT dev: launches Chrome with the extension and HMR
pnpm build        # builds the extension (apps/extension/.output/chrome-mv3) and @specimen/mcp
pnpm typecheck && pnpm lint
pnpm test         # Vitest, all packages
```

Try the extension on a URL in a throwaway Chrome profile: `pnpm -F @specimen/extension try <url>`. Save a real site's page data as a fixture: `pnpm capture <url>`.

## Repo layout
- `packages/core`: pure TypeScript (no `chrome.*`, no live DOM). Schema, color math, extractors, generators, compose, diff, a11y. Most logic and tests live here.
- `packages/ai`: the `LLMProvider` interface and adapters (WebLLM, Chrome built-in, OpenAI-compatible, Anthropic, Gemini).
- `packages/mcp`: `@specimen/mcp`, the stdio MCP server plus the local WebSocket bridge.
- `apps/extension`: WXT, React 19, Tailwind v4. Entrypoints: background, sampler/overlay content scripts, offscreen, side panel, options.
- `fixtures/`: static pages with known values and captured real-site data.

## Rules of the road
- `DesignScan` (`packages/core/src/schema`) is the single contract. Change it only with a `schemaVersion` bump and a migration.
- Extraction is deterministic. AI only enhances it, and every AI feature must work (degrade) with no provider.
- Permissions are the ones listed in ARCHITECTURE §10. No static `content_scripts`.
- Never log API keys or the MCP pairing token. Never send page data anywhere except the user's chosen provider (or the local MCP server).
- Generated prompts must not contain logos, brand names or headline copy.
- TypeScript strict, Biome for lint and format, small files, tests next to the code (`*.test.ts`) or in `test/`.

## How to add a generator
1. Add `packages/core/src/generate/<name>.ts` exporting `generateX(scan: DesignScan): GeneratedFile`. Keep it pure and deterministic, and run output through `sanitize` if it can contain text.
2. Add its id to `GeneratorId` and an entry to `GENERATORS` in `packages/core/src/generate/index.ts`. The side panel's Generate view and the MCP `get_tokens` format list are built from that registry.
3. Export it from `generate/index.ts` and add a snapshot test against `fixtures/raw/*.json`.

## How to add an AI provider
1. Add `packages/ai/src/providers/<name>.ts` implementing `LLMProvider` (stream deltas, honor abort, map failures to `ProviderError`).
2. Register it in `packages/ai/src/registry.ts` (a preset for OpenAI-compatible endpoints is usually enough: base URL, default model, vision flag).
3. Page text goes to the model truncated and wrapped in `<page_data>`. Keys are stored only in `chrome.storage.local`.

## How to add an MCP tool
1. In `packages/mcp/src/server.ts`, call `server.registerTool(name, { title, description, inputSchema }, handler)`. `inputSchema` is a zod shape; write the description for an agent (when to call it, what it returns).
2. Compute from the stored `DesignScan` with `@specimen/core`. Return text content; on failure return `isError: true` with a message the agent can act on.
3. Never write to stdout (it is the MCP channel); log to stderr. If the tool needs the browser, add a request/response pair to the WS protocol (`protocol.ts`, `bridge.ts`, and the extension's `lib/mcpBridge.ts`) and document it in ARCHITECTURE §14.
4. Run it by hand: `pnpm -F @specimen/mcp build`, then connect with an MCP client (or the MCP Inspector) to `node packages/mcp/dist/cli.js`.

## Workflow
- Branch from `main`: `phase-<n>-<slug>` for planned work, `feat/…` or `fix/…` otherwise.
- Keep a change focused. Run `pnpm typecheck && pnpm lint` before pushing; add or update tests for behavior you change.
- Open a pull request using the template. Squash merge.

## Commit style
[Conventional Commits](https://www.conventionalcommits.org): `feat(core): add figma variables export`, `fix(extension): keep the side panel open on tab change`, `docs: explain MCP pairing`. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.

## Reporting issues
Use the issue templates. For a bad scan, include the site URL (or a minimal HTML page that reproduces it) and your Chrome version.
