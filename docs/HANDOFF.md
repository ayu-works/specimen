# Session handoff (2026-10-14)

Read `CLAUDE.md` first for the rules. The team workflow is `docs/sprint/setup.md` (on branch `sprint/log` until sprint 1 ends: `git show sprint/log:docs/sprint/setup.md`). This file says where things stand.

## Done
| What | PR |
|---|---|
| Phases 0–5: scaffold, extraction, outputs, AI, Library/Compose, fidelity/mobile/dark/a11y | #1–#6 |
| Testing pass: 170 unit + 26 e2e tests, 87/87 test IDs, fixes; includes the fidelity card (#8) | #9 |
| Phase 6 release kit: README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, PRIVACY, templates, v1.0.0, `pnpm zip`, `release.yml`, `store/` listing kit, pixel-critter icon and mascot moods | #10 |
| Promo video: `apps/video` (Remotion + code synth), four cuts × three formats | #11 |
| Store images (`store/images/`: 5 screenshots 1280×800, promo 440×280, marquee 1400×560, icon 128) and repo cleanup | #12 |
| CI: faster gate, separate video check | #13 |
| Store listing: keyword-spam rejection fix | #14 |
| Website: pixel-art landing page, `/privacy`, Netlify config; phone scrolling; external links | #15–#17 |
| T6.07: gitleaks scan of the whole history, in the gate and CI | #18 |
| T7.04: Remotion compositions have frame count = fps × duration | #20 |

## Promo video
- The approved cut is **`mix`**: the 30 s picture with the user's Suno song mixed into the chiptune, opening on "love this site?" (31.3 s). Use it for the website and the store.
- Render: `pnpm -F @specimen/video render Promomix-16x9` (or `-1x1`, `-9x16`). Output lands in `apps/video/out/1-main-mix/` (gitignored). Details in `apps/video/README.md`.
- The Suno song (`design/video/audio/specimen-suno.webm`) is gitignored. Its commercial use depends on the user's Suno plan: remind them before publishing.
- The "scanned" site in the video is made up. No real brands, logos or copy.

## Open
- **Live on the Chrome Web Store** (2026-10-13): https://chromewebstore.google.com/detail/pbolkplggojhilegibocfkaeonjakkgp
- **Website**: `site/` (plain HTML, no build), live on Netlify, deployed from `main` via `netlify.toml`. `/privacy` is the privacy page. Netlify is on the Free plan: each production deploy costs 15 of 300 credits a month, and the site pauses if they run out, so batch `site/` changes into few merges. Merges that don't touch `site/` are skipped by `netlify.toml`'s `ignore`.
- **Owner check:** confirm the store listing's privacy policy URL points at the site's `/privacy` (nobody on the team can see the dashboard).
- **Sprint 1** (close the test gaps): website e2e T7.01 + T7.03 is open (SPC-8, PR #19); Lighthouse T7.02 is SPC-11.
- **Branch `phase-6-mcp`**: the cancelled MCP bridge, kept on purpose. Don't delete it. Open questions: is the value only the self-check loop (`check_build`)? How much browser control should agents get? Standalone headless CLI instead? The decision is SPC-10 (owner backlog).
- Manual items still with the user: the Alt+Shift+C shortcut, the Gemma download, a real "AI builds page → Fidelity check".

## Brand assets
Mascot `design/logo/final/specimen-critter.svg` (never alter it); mood variants in `apps/extension/src/components/Mascot.tsx`; wordmark and banners in `.github/assets/`; store visuals in `store/images/`. Colors: body `#7C6CF5`, shine `#A99BFF`, tuft `#FF6B6B #FFD166 #06D6A0 #4D96FF`, ink `#1b1b2f`, store background `#0e0e16`.

## Notes
- CI is green on `main` (run 38573173204, 2026-10-14). The `gate` job skips installing `apps/video`; the `video` job typechecks it only when `apps/video` or the lockfile changes. Root `pnpm typecheck` skips the video; use `pnpm typecheck:video`.
- Token exports (Tailwind, CSS vars, shadcn, DTCG, Figma) exist in `packages/core`, but the side panel only offers Prompt and DESIGN.md. Don't market tokens.
- The first scan requests optional `<all_urls>` (the side panel opened from the toolbar doesn't get activeTab). The justification is in `store/privacy-practices.md`.
- Delete merged branches after each merge (GitHub auto-delete is off).

## How the user likes to work
- Reduce cognitive load: plain language, fewer choices, short updates.
- Ask before creative changes; leave existing renders untouched when making a new variant.
- Merge, delete or commit only when the user says so.
