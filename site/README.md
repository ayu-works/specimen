# Website

The Specimen landing page. Plain HTML with no build step; Netlify publishes this folder as is (settings in [`../netlify.toml`](../netlify.toml)).

- `index.html`: the landing page (pixel-art stages and the pet).
- `privacy/index.html`: the privacy policy, served at `/privacy`. Keep it in sync with [`../PRIVACY.md`](../PRIVACY.md).

## Fonts
Both fonts are self-hosted in `fonts/` (no requests to Google): `index.html` and `privacy/index.html` preload them and declare them in an inline `@font-face`, and the CSP in `netlify.toml` allows `font-src 'self'`. Both are under the SIL Open Font License 1.1 (`fonts/OFL-*.txt`).

- `pressstart2p-regular.woff2` (sha256 `716ecdc1…755089a7d43`): Press Start 2P, the **complete** upstream font. Source: `PressStart2P-Regular.ttf` (Version 3.000, sha256 `034c77f1…728e017d`) from https://github.com/google/fonts/tree/main/ofl/pressstart2p, converted losslessly to WOFF2 with fontTools (`TTFont(...).flavor = 'woff2'`). Glyphs, cmap and `name` table are unchanged; the `DSIG` table is dropped and the `head` timestamp and checksum are recomputed. **Never subset or rename it:** the license reserves the name "Press Start 2P", and a subset or renamed font is a Modified Version that may not use that name.
- `vt323-latin.woff2`: VT323, the `latin` subset Google Fonts serves (from https://fonts.gstatic.com/s/vt323/v18/pxiKyp0ihIEF2isfFJXUdVNF.woff2, fetched 2026-10-14). VT323 has no Reserved Font Name, so a subset may keep its name.
- The website tests (`apps/extension/e2e/site/`) load these same files, so there is one copy.

## Update the site
Edit files here and merge to `main`. Netlify deploys on every push to `main` that changes `site/`, and builds a preview link for each pull request.

## Preview locally
```bash
python3 -m http.server 4321 -d site
```
Then open http://localhost:4321.

## Short links
`/install` goes to the Chrome Web Store listing and `/github` to the repo (see `netlify.toml`).
