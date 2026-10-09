# Contributing to Specimen

Thanks for helping. This guide covers setup, the rules, and three common changes. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Setup
Requires Node 22+ and pnpm through corepack.

```bash
corepack enable
pnpm i
pnpm dev        # launches Chrome with the extension and hot reload
```

To try a build on a real site: `pnpm build`, then `pnpm -F @specimen/extension try <url>`. That opens Chromium with the extension loaded in a throwaway profile.

## Project layout
- `packages/core`: pure TypeScript. No `chrome.*`, no live DOM. Schema (`src/schema`), color math (`src/color`), extractors (`src/extract`), generators (`src/generate`), compose, diff, a11y, themes. Most logic and most tests live here.
- `packages/ai`: the `LLMProvider` interface (`src/types.ts`), adapters (`src/providers`), presets (`src/presets.ts`) and AI features (`src/features`).
- `apps/extension`: WXT + React 19 + Tailwind v4. Entry points are in `src/entrypoints` (background, sampler and overlay content scripts, offscreen, sidepanel, options). Shared code is in `src/lib`.
- `fixtures/pages`: static HTML pages with `*.expected.json` ground truth. `fixtures/raw`: captured real sites.
- `docs`: [PLAN](docs/PLAN.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [IMPLEMENTATION](docs/IMPLEMENTATION.md), [TESTING](docs/TESTING.md).

## Commands
```bash
pnpm typecheck && pnpm lint
pnpm test        # Vitest, all packages
pnpm build
pnpm e2e         # Playwright; loads the built extension (run pnpm build first)
pnpm gate        # typecheck + lint + test + build + e2e + test-ID check
pnpm format      # Biome auto-format
```
On Linux CI the e2e run uses `xvfb-run`. Playwright needs `pnpm -F @specimen/extension exec playwright install chromium` once.

## Code style
- TypeScript strict. Biome handles lint and format (`pnpm lint`, `pnpm format`).
- Keep files small and functions focused.
- Tests sit next to the code (`*.test.ts`) or in the package's `test/` folder.
- Extraction is deterministic. AI may only enhance it, and every AI feature must work (by hiding or falling back) with no provider configured.

## Rules that are not negotiable
- **`DesignScan` is the single contract** (`packages/core/src/schema`). Changing its shape needs a `schemaVersion` bump (`SCHEMA_VERSION` in `schema/index.ts`, the literal in `schema/scan.ts`) and a migration in `schema/migrations.ts`.
- **Ethics guardrail.** Generated prompts must not contain logos, brand names or headline copy. Output comes from measured values only. `sanitize` in `packages/core/src/generate/sanitize.ts` and its tests enforce this.
- **Privacy and security.** Never log API keys. Keys live only in `chrome.storage.local`, never `storage.sync`. Page data goes only to the provider the user chose. Page text sent to an LLM is truncated and wrapped in `<page_data>` as data (`packages/ai/src/features/pageData.ts`).
- **Permissions.** Add none without a strong reason. No static `content_scripts`. Host access stays in `optional_host_permissions`. See ARCHITECTURE section 10.
- **No remote code.** Everything executable is bundled.

## How to add an export generator
Generators are pure functions in `packages/core/src/generate`.

1. Create `packages/core/src/generate/<name>.ts` exporting `generateX(scan: DesignScan): GeneratedFile` (see `cssvars.ts` for a small example; `GeneratedFile` is in `common.ts`). Build output from the scan only, and use helpers from `common.ts`.
2. In `packages/core/src/generate/index.ts`: export it, add its id to the `GeneratorId` union, and add an entry to the `GENERATORS` array (`id`, `label`, `ext`, `mime`, `run`).
3. To show it in the side panel, add it to `FORMATS` in `apps/extension/src/entrypoints/sidepanel/views/Generate.tsx` (today it offers only Prompt and DESIGN.md; the picker is a two-column grid, so adjust the layout if you add more).
4. Add a test in `packages/core/test/generate.test.ts`. Output must be byte-identical for the same scan, and must contain no brand names or page text.

For a new prompt target (a new agent), edit `packages/core/src/generate/prompt/targets.ts` and the spec in `prompt/SPEC.md`, then add its icon in `Generate.tsx` (`TARGET_ORDER`, `TARGET_ICONS`).

## How to add an AI provider
Most providers speak the OpenAI chat API, so they only need a preset.

**OpenAI-compatible provider (preset only):**
1. Add an entry to `PRESETS` in `packages/ai/src/presets.ts` with `kind: 'openai'`, `baseUrl`, a default `model`, `needsKey`, `vision` and `contextTokens`.
2. That is all for the UI. `apps/extension/src/entrypoints/options/Byok.tsx` lists `PRESETS`, and `apps/extension/src/lib/aiByok.ts` builds the adapter. Chrome asks for access to the provider's address when the user saves a key (`requestProviderPermission` in `src/lib/aiSettings.ts`).
3. Test the request and error mapping in `packages/ai/src/providers/providers.test.ts`.

**A provider with its own API shape:**
1. Add `packages/ai/src/providers/<name>.ts` that returns an `LLMProvider` (`src/types.ts`): `id`, `label`, `capabilities`, `status()` and `chat()` (an async iterator of text deltas). Use `postSse` from `providers/http.ts` so every failure becomes a `ProviderError` through `httpError` / `mapThrown` (`errors.ts`). Error messages must never include keys or raw response bodies.
2. Export it from `packages/ai/src/index.ts`.
3. Add a `ProviderKind` in `presets.ts`, a preset, and a branch in `resolveByokProvider` (`apps/extension/src/lib/aiByok.ts`). Check the branch in `src/lib/aiRuntime.ts` too.
4. Add tests with a mocked `fetch` (see `providers.test.ts`). `@specimen/ai/testing` has a mock provider for feature tests.

## How to add or improve an extractor
Extractors take a `RawPage` (what the sampler measured) and return parts of a `DesignScan`. They live in `packages/core/src/extract` (`colors.ts`, `typography.ts`, `spacing.ts`, `radii.ts`, `shadows.ts`, `layout.ts`, `components.ts` and others), wired together in `extract/index.ts`.

1. Reproduce the problem. For a real site, run `pnpm capture <url> [name]`. It saves the `RawPage` to `fixtures/raw/<name>.json` using the same sampler as the extension.
2. For a controlled case, add `fixtures/pages/<name>.html` and a `fixtures/pages/<name>.expected.json` with the true values (colors, type sizes, base unit, container width). `pnpm fixtures:raw` regenerates `fixtures/raw/pages/*.json` from the HTML pages. `fixtures/serve.ts` serves the pages.
3. Change the extractor. Keep it deterministic (same input, same output).
4. Add the page to the `PAGES` list in `packages/core/test/extract.test.ts` and assert against the expected values. Run `pnpm test`. `pnpm fixtures:summary` prints a summary of the captured sites.
5. If you added a field to `DesignScan`, follow the schema rule above.

## Pull request checklist
- [ ] `pnpm typecheck && pnpm lint` pass; `pnpm test` passes for what you touched. Run `pnpm gate` for larger changes.
- [ ] Tests added or updated, next to the code or in `test/`.
- [ ] No new permission, or the reason is in the PR description.
- [ ] No API keys, page content or personal data in code, tests, fixtures or logs.
- [ ] Schema changes have a `schemaVersion` bump and a migration.
- [ ] Generated prompts still contain no logos, brand names or page copy.
- [ ] Docs updated if behavior changed (README, `docs/`).
