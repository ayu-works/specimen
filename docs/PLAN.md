# Product Plan: open-source "Siteprint for Chrome"

> Working name: **Specimen** (placeholder; alternatives: *Tastegrab*, *Lookbook*, *Stylecast*, *DesignDNA*). Decide before the Chrome Web Store listing.
> Status: draft for discussion · Last updated: 2026-10-08

---

## 1. What we're copying: Siteprint teardown

**Siteprint** ([siteprint.app](https://siteprint.app)) is a paid macOS **Safari extension**, sold on the Mac App Store.

**Core idea:** it measures a website's visual system and packages it as **one measured prompt** for an AI coding agent. It doesn't build anything itself. The agent (Claude Code, Codex, Cursor, Lovable…) builds a new page with the same look.

**Workflow:** pick a site → Siteprint measures it → copy the output into your coding agent.

| Area | What it does |
|---|---|
| Measures | colors with roles, type (families, sizes, weights), spacing, corner radii, layout / page blueprint |
| Outputs | copyable prompt, `DESIGN.md` (hex, sizes, weights, radii), token export, palette with roles, font families, page blueprint |
| Tools | inspector, eyedropper, grid overlay, Library of scans |
| Pro ($9.99 one-time) | full prompts + DESIGN.md, Themes, **Compose** (site A's colors + site B's type/layout), **local MCP server** so agents read scans directly |
| AI | "Ask this design" uses **Apple Intelligence** (supported Macs only). Everything else is deterministic |
| Limits | Safari + macOS 14+ only, no Chrome, closed source, no model choice |

**Showcase examples:** Margin (from Linear), Splitwave (from Stripe), Tally (from Ramp), Chairly (from Cal.com).

**What it gets right:** deterministic measurement (not AI guessing), output aimed squarely at coding agents, and a privacy-first design with no account.

**Gaps we can exploit:** it's Safari only and closed, AI depends on Apple hardware, there's no feedback loop after the agent builds, it extracts tokens rather than components or states, and it has a paywall.

---

## 2. What we're building

A **free, open-source (MIT) Chrome MV3 extension** that does the same core loop:

> **Scan a site → measured design system → agent-ready prompt / DESIGN.md / tokens**

AI features can run on:
1. **Gemma, locally in the browser** (WebGPU via WebLLM): offline after a one-time download, and nothing leaves the machine.
2. **Any API key** (BYOK): OpenAI-compatible endpoints (OpenAI, OpenRouter, Groq, Together, Mistral, DeepSeek, Ollama, LM Studio, …), Anthropic, Google Gemini.
3. **No model at all**: all extraction and exports are deterministic and work without AI.

There's no backend, no account, and no telemetry.

---

## 3. Feedback & improvements

The original teardown feedback wasn't substantial, so the items marked ★ are **proposed improvements** to be trimmed or reordered in discussion.

| # | Improvement | Why it matters |
|---|---|---|
| 1 | Chrome + open source + all "Pro" features free | Largest browser, community contributions, trust |
| 2 | Model choice: local Gemma / any API key / none | Not tied to Apple hardware; private by default |
| 3 | ★ **Fidelity check ("Diff")**: scan the page the agent built (e.g. `localhost:3000`), compare it to the source scan, get a score plus a "fix these deltas" follow-up prompt | Closes the loop Siteprint leaves open. **Headline feature** |
| 4 | ★ **Component specs**: buttons, inputs, cards, nav, badges with hover/focus/active states | Agents get the details right, not only the tokens |
| 5 | ★ **Responsive + dark mode capture**: breakpoints from `@media`, re-scan at mobile width and in dark mode | Real sites aren't one viewport |
| 6 | ★ **Vision "vibe" summary**: screenshot → multimodal model → mood, density, imagery style | Captures what numbers can't |
| 7 | ★ **Accessibility pass**: WCAG contrast for every role pair, with suggested accessible variants | Generated sites ship accessible |
| 8 | ★ **More export targets**: Tailwind v4 `@theme`, CSS vars, shadcn/ui theme, W3C DTCG JSON, Figma Variables JSON; agent-specific prompt templates | Drops into any stack |
| 9 | ★ **Multi-page scan**: merge home + pricing + docs into one system | More complete system |
| 10 | ★ **Ethics guardrail**: "inspiration, not cloning". Strip logos and brand copy, add a trademark note | Responsible positioning, store-review safe |

---

## 4. Feature set by release

### v0.1: MVP (Phases 0–2)
- Scan the active tab → design system (colors+roles, type scale, spacing, radii, shadows, layout blueprint)
- Side panel with Inspect view, grid overlay, eyedropper
- Exports: prompt, DESIGN.md, Tailwind v4, CSS vars, shadcn theme, DTCG JSON; copy / download

### v0.2: AI (Phase 3)
- Local Gemma (WebGPU) with a guided download, plus BYOK for any provider
- "Ask this design" chat, AI-polished prompt, vision vibe summary

### v0.3: Library & Compose (Phase 4)
- Library of scans (search, thumbnails, import/export), Compose by facet, Themes (light/dark variants)

### v0.4: Differentiators (Phase 5)
- Component + state specs, responsive/dark capture, a11y pass, **Fidelity Diff**, multi-page merge

### v1.0: Launch (Phases 6–7)
- MCP bridge (`npx specimen-mcp`), Chrome Web Store, GitHub release, landing website, product video

---

## 5. Phases

| # | Phase | Deliverable | Who |
|---|---|---|---|
| 0 | Scaffold | Monorepo, WXT extension loads with empty side panel, tests wired | Sonnet builds, Opus reviews |
| 1 | Extraction engine | Content sampler + `core/extract` + schema + Inspect UI + overlays | Sonnet / Opus |
| 2 | Outputs (no AI) | Prompt, DESIGN.md, token exporters, copy/download | Sonnet / Opus |
| 3 | AI layer | Provider interface, WebLLM Gemma, BYOK adapters, Ask, vibe | Sonnet / Opus |
| 4 | Library + Compose | IndexedDB library, Compose, Themes | Sonnet / Opus |
| 5 | Differentiators | Components/states, responsive/dark, a11y, Diff, multi-page | Sonnet / Opus |
| 6 | MCP + release | MCP package, store listing, docs, CONTRIBUTING | Sonnet / Opus |
| 7 | Website + video | Landing site (`apps/web`), Remotion product video | Sonnet / Opus |

**Model policy:** planning, architecture and code review use **Opus**. All implementation is delegated to **Sonnet** subagents. Opus reviews each phase's diff before the next phase starts.

---

## 6. Website & video (Phase 7)
- **Website:** a single landing page in `apps/web` (Astro, static). Hero with a live before→after demo, "how it works" in 3 steps, the feature grid, the local-AI privacy story, an open-source/GitHub CTA, and an "Add to Chrome" button. The site should be designed *using the extension itself* (dogfooding).
- **Product video:** built with **Remotion** (React → MP4) so it's versioned in the repo.
  - ⚠️ **Length to confirm:** the request said "3 sec". A 3-second clip only works as a looping teaser (scan → prompt → built page). Proposal: a **3 s loop** for social/hero plus a **30 s** full walkthrough.

---

## 7. Open questions
1. Final product name + domain.
2. Video: 3 s teaser only, or 3 s + 30 s?
3. Default local model: Gemma 2 2B (proven in WebLLM) vs Gemma 3 1B/4B (check WebLLM's prebuilt list at build time; 4B gives vision).
4. GitHub org / repo name; license MIT (proposed).
5. Which ★ improvements are in for v1.0?

## 8. Success criteria
- Scanning linear.app / stripe.com / ramp.com / cal.com in < 3 s gives a prompt from which Claude Code builds a page that "looks like the same family".
- Fidelity Diff score ≥ 80/100 on those builds after one fix round.
- Gemma runs fully offline after download; a BYOK provider works with only a key (plus a base URL).
