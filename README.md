# Specimen (working name)

Open-source Chrome extension that measures any website's design system — colors, type, spacing, radii, layout — and turns it into an agent-ready prompt, `DESIGN.md`, and design tokens. AI features run on **Gemma locally in your browser (WebGPU)** or **your own API key**. No account, no backend, no telemetry.

> Status: planning. See [docs/PLAN.md](docs/PLAN.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Development
Requires Node 22+ and pnpm (`corepack enable`; the version is pinned in `package.json`).

```bash
pnpm i                                                   # install
pnpm -F @specimen/extension exec playwright install chromium   # one-time, for e2e
pnpm dev                                                 # WXT dev: launches Chrome with HMR
pnpm gate                                                # typecheck + lint + unit + build + e2e + test-ID check
```

## License
[MIT](LICENSE)
