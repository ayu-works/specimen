# Vendored web fonts (test fixtures only)

The website loads Press Start 2P and VT323 from Google Fonts. The tests never reach the network, so the route stub in
`../checks.ts` serves these copies instead. That way T7.03 measures the layout the real fonts produce.

- `pressstart2p-latin.woff2`: https://fonts.gstatic.com/s/pressstart2p/v16/e3t4euO8T-267oIAQAu6jDQyK3nVivNm4I81.woff2
- `vt323-latin.woff2`: https://fonts.gstatic.com/s/vt323/v18/pxiKyp0ihIEF2isfFJXUdVNF.woff2
- Both are the `latin` subsets that `https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap`
  listed. Fetched 2026-10-14.
- License: SIL Open Font License 1.1 (`OFL-PressStart2P.txt` and `OFL-VT323.txt`, from github.com/google/fonts).

These copies can drift from what Google serves; that's accepted. To refresh them, fetch the CSS URL above with a
desktop Chrome user agent and download its `latin` woff2 files.
