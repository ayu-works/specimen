# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-09
First public release.

### Added
- **Scan** any page from the side panel. Specimen measures colors (with roles such as background, text, accent), type, spacing, radii, shadows, borders and layout, in your browser.
- **Inspect** the result: palette, type scale, spacing, shapes, components with their states, a layout blueprint and an accessibility check of text and border contrast against WCAG AA.
- **Page overlays**: a baseline grid, a live element inspector and an eyedropper.
- **Generate** an agent-ready prompt for Claude Code, Cursor, v0, Lovable or a generic agent, or a `DESIGN.md`. Optionally include the site's other theme. Copy or download.
- **Mobile and dark/light capture**, and **multi-page** scans that merge several pages of one site.
- **Fidelity check**: compare a page you built with the original and get a prompt that fixes the differences.
- **Library**: scans are saved locally (IndexedDB). Search, tag, favorite, re-scan, export and import. **Compose** mixes colors, type, spacing, shape and layout from different scans.
- **Optional AI**: Ask about a design, Polish the prompt, and a Vibe summary. Runs on local Gemma (WebLLM and WebGPU, 1B, 2B or 9B), Chrome's built-in model when present, or your own API key (Anthropic, OpenAI, Gemini, OpenRouter, Groq, Together, Mistral, DeepSeek, xAI, Ollama, LM Studio or any OpenAI-compatible endpoint). Without AI, everything else works.
- Shortcuts: `Alt+Shift+S` opens the panel; `Alt+Shift+C` opens it, scans and shows Generate.
- Token generators in `@specimen/core`: Tailwind v4 and v3, CSS variables, shadcn/ui, W3C design tokens and Figma variables. The panel does not expose them yet.
- Open-source docs: README, CONTRIBUTING, Code of Conduct, Security policy, privacy policy, issue and pull request templates.

### Privacy and security
- No backend, no account, no analytics, no telemetry. No `host_permissions` at install; site access is an optional one-time grant. `debugger` is optional and requested only when a capture needs it.
- API keys are stored only in `chrome.storage.local`, optionally encrypted with a passphrase.
- Page text sent to an AI provider is truncated and marked as data.

### Fixed
- Provider rate-limit errors now show a short, friendly message and never include the raw response (which can contain account ids).
