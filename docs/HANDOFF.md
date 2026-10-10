# Session handoff (2026-10-10)

Read `CLAUDE.md` first. It holds the workflow and rules. This file says where things stand.

## Done
| What | PR |
|---|---|
| Phases 0–5: scaffold, extraction, outputs, AI, Library/Compose, fidelity/mobile/dark/a11y | #1–#6 |
| Testing pass: 170 unit + 26 e2e tests, 87/87 test IDs, fixes; includes the fidelity card (#8) | #9 |
| Phase 6 release kit: README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, PRIVACY, templates, v1.0.0, `pnpm zip`, `release.yml`, `store/` listing kit, pixel-critter icon and mascot moods | #10 |
| Promo video: `apps/video` (Remotion + code synth), four cuts × three formats | #11 |
| Store images (`store/images/`: 5 screenshots 1280×800, promo 440×280, marquee 1400×560, icon 128) and repo cleanup | #12 |

## Promo video
- The approved cut is **`mix`**: the 30 s picture with the user's Suno song mixed into the chiptune, opening on "love this site?" (31.3 s). Use it for the website and the store.
- Render: `pnpm -F @specimen/video render Promomix-16x9` (or `-1x1`, `-9x16`). Output lands in `apps/video/out/1-main-mix/` (gitignored). Details in `apps/video/README.md`.
- The Suno song (`design/video/audio/specimen-suno.webm`) is gitignored. Its commercial use depends on the user's Suno plan: remind them before publishing.
- The "scanned" site in the video is made up. No real brands, logos or copy.

## Open
- **Chrome Web Store submission is on hold** (user decision). Everything is ready: `pnpm zip`, `store/SUBMIT.md`, `store/images/`. The user submits with their own developer account. The README store badge still points to `…/detail/specimen/TODO`.
- **Website (Phase 7.1–7.2)** not started. Host: Vercel. It must serve `/privacy` so the store listing can link to it.
- **Branch `phase-6-mcp`**: the cancelled MCP bridge, kept on purpose. Don't delete it. Open questions: is the value only the self-check loop (`check_build`)? How much browser control should agents get? Standalone headless CLI instead? Before or after launch?
- Manual items still with the user: the Alt+Shift+C shortcut, the Gemma download, a real "AI builds page → Fidelity check".

## Brand assets
Mascot `design/logo/final/specimen-critter.svg` (never alter it); mood variants in `apps/extension/src/components/Mascot.tsx`; wordmark and banners in `.github/assets/`; store visuals in `store/images/`. Colors: body `#7C6CF5`, shine `#A99BFF`, tuft `#FF6B6B #FFD166 #06D6A0 #4D96FF`, ink `#1b1b2f`, store background `#0e0e16`.

## Notes
- CI: the `gate` job skips installing `apps/video`; the `video` job typechecks it only when `apps/video` or the lockfile changes. Root `pnpm typecheck` skips the video; use `pnpm typecheck:video`.
- Token exports (Tailwind, CSS vars, shadcn, DTCG, Figma) exist in `packages/core`, but the side panel only offers Prompt and DESIGN.md. Don't market tokens.
- The first scan requests optional `<all_urls>` (the side panel opened from the toolbar doesn't get activeTab). The justification is in `store/privacy-practices.md`.
- Delete merged branches after each merge (GitHub auto-delete is off).

## How the user likes to work
- Opus plans and reviews; Sonnet builds. Opus makes small fixes itself (the video was an exception: Opus built it).
- Reduce cognitive load: plain language, fewer choices, short updates.
- Ask before creative changes; leave existing renders untouched when making a new variant.
- Merge, delete or commit only when the user says so.
