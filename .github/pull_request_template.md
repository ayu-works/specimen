## What and why

## How I checked it
- [ ] `pnpm typecheck` and `pnpm lint` pass
- [ ] Tests added or updated for changed behavior
- [ ] Tried it in Chrome (`pnpm dev` or `pnpm -F @specimen/extension try <url>`) if it touches the extension

## Checklist
- [ ] No new permissions, or ARCHITECTURE §10 is updated
- [ ] No logging of API keys or the MCP pairing token
- [ ] `DesignScan` changes come with a `schemaVersion` bump and a migration
- [ ] Docs updated (README, ARCHITECTURE, CONTRIBUTING) if behavior changed
