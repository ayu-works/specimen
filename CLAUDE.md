# CLAUDE.md

Open-source (MIT) Chrome MV3 extension that measures a website's design system (colors + roles, type, spacing, radii, shadows, layout) and exports an agent-ready prompt, `DESIGN.md` and tokens. Optional AI runs on local Gemma (WebLLM/WebGPU) or the user's own API key. There is no backend, no account, and no telemetry.

- Product: [docs/PLAN.md](docs/PLAN.md) · Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Tasks: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) · Tests: [docs/TESTING.md](docs/TESTING.md)
- Repo: https://github.com/ayu-works/specimen (public). "Specimen" is a working name.

## Workflow (mandatory)
Each phase in IMPLEMENTATION.md runs this loop. Don't start phase N+1 until phase N is merged.

1. **Branch**: `phase-<n>-<slug>` from `main`.
2. **Build the whole phase, code only**: a single Sonnet subagent (`Agent` with `model: "sonnet"`, run in the background) implements **every** task of the phase. It writes **no tests** and runs **no tests**; at most one `pnpm typecheck && pnpm lint` at the end so the code compiles. Subagents **do not commit or push**.
3. **Review**: only once everything in the phase is implemented, Opus (the main session) reads the whole phase's code against ARCHITECTURE.md, the security rules below and the task ACs. Opus applies small, targeted fixes itself (faster than a new agent brief). Only large fix sets go back to Sonnet.
4. **Lint**: `pnpm lint` must be clean. **Automated tests are deferred to the end of the whole product build** (user decision, 2026-10-09). Each phase's tests from `docs/TESTING.md` are written in a final testing pass, and then `pnpm gate` runs for all phases. Until then, the user tests by hand with `pnpm -F @specimen/extension try <url>`, and CI may be red.
5. **Final testing pass** (after Phase 7): write the missing tests, run `pnpm gate` for every phase, fix failures in batches, and report the real output.
6. **Ship**: Opus commits, pushes, and opens a PR with `gh`; it's merged when the user says so. Tick the phase in IMPLEMENTATION.md.

Opus does planning, architecture and review. Sonnet does all implementation.

## Commands
```bash
pnpm i                 # install (pnpm via corepack; packageManager pinned in package.json)
pnpm dev               # WXT dev: launches Chrome with the extension, HMR
pnpm build             # production build → apps/extension/.output/chrome-mv3
pnpm test              # Vitest, all packages
pnpm e2e               # Playwright, loads the built extension in Chromium
pnpm typecheck && pnpm lint
pnpm gate              # everything above; the phase gate
pnpm capture <url>     # save a real site's RawPage into fixtures/raw/
```

## Layout
- `packages/core`: **pure TS, no `chrome.*`, no live DOM.** Schema (zod), color math, extractors, generators, compose, diff, a11y. Most logic and most tests live here.
- `packages/ai`: `LLMProvider` interface + adapters (webllm, chromeBuiltin, openaiCompat, anthropic, gemini).
- `apps/extension`: WXT + React 19 + Tailwind v4 + shadcn/ui. Entrypoints: background, sampler/overlay content scripts (injected on demand), offscreen (WebLLM), sidepanel, options.
- `fixtures/`: `pages/*.html` with `*.expected.json` ground truth; `raw/*.json` captured real sites.

## Rules
- `DesignScan` in `packages/core/src/schema` is the single contract. Change it only with a `schemaVersion` bump plus a migration.
- Extraction is deterministic. AI only enhances it, and every AI feature must degrade gracefully with no provider configured.
- Permissions: only what ARCHITECTURE.md §10 lists. No static `content_scripts`. Host access goes through `optional_host_permissions`.
- Never log API keys. Store them only in `chrome.storage.local`, never `storage.sync`. Never send page data anywhere except the user's chosen provider.
- Page text sent to an LLM is truncated and wrapped in `<page_data>` as data.
- Generated prompts must not contain logos, brand names or headline copy (ethics guardrail, tested).
- TypeScript strict; Biome for lint/format; small files; tests next to code (`*.test.ts`) or in `test/`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
