# Promo video

The Specimen promo, in two cuts (30 s and 40 s), each in three formats, made entirely in code: [Remotion](https://www.remotion.dev) draws the picture, and a small chiptune synth (`scripts/music.ts`) writes the soundtrack. The sound is baked into each MP4.

```bash
pnpm -F @specimen/video render                  # all six → apps/video/out/
pnpm -F @specimen/video render Promo30s-1x1     # just one
pnpm -F @specimen/video studio                  # live preview in the browser
```

| Cut | Picture | Music | Compositions |
|---|---|---|---|
| **mix** | speed 1, grey hook at 0.6× | Suno song (stretched to 120 BPM) + chiptune in its key | `Promomix-16x9`, `Promomix-1x1`, `Promomix-9x16` |
| **suno** | speed 0.875 | Suno song only | `Promosuno-…` |
| **30s** | speed 1 | 120 BPM | `Promo30s-16x9`, `Promo30s-1x1`, `Promo30s-9x16` |
| **40s** | speed 0.75 | 90 BPM, double-time drums/bass/arp | `Promo40s-16x9`, `Promo40s-1x1`, `Promo40s-9x16` |

Files land in one folder per cut:

| Folder | Cut |
|---|---|
| `out/1-main-mix/` | **mix**: the approved promo (Suno song + chiptune) |
| `out/2-chiptune-30s/` | **30s** |
| `out/3-chiptune-40s-slow/` | **40s** |
| `out/4-suno-only/` | **suno** |

Each holds `…-landscape-16x9.mp4` (1920×1080), `…-square-1x1.mp4` (1080×1080) and `…-vertical-9x16.mp4` (1080×1920).

## How it fits together
- `src/timeline.ts` is the single clock. It's written in "design seconds" (120 BPM, 30 s). Each entry in `VARIANTS` has a `speed` that stretches the whole film at render time, and `scripts/music.ts <cut>` writes the matching `public/audio-<cut>.wav`. To add a cut, add a variant. Scene starts, lyric timings, sound effects and the token counter all live there. The music script and the scenes both import it, so every hit lands on its frame. To move a beat, change it here.
- `scripts/music.ts` synthesizes everything: pulse lead, 16th arp, 4-bit triangle bass, noise drums, kick sidechain, the tape stop into the callback, and all SFX (typing, keycaps, slams, stamps, whooshes, sparkles). The output is deterministic.
- `src/scenes/*` holds one component per scene. Each gets the global time `t`, the scene-local time `lt`, and the layout `L`. `pick(L, wide, square, tall)` handles the three aspect ratios.
- `src/components/Critter.tsx` is the mascot, pixel for pixel the same as the extension's. Don't alter the art.

The reference breakdown is in `design/video/analysis.md`. The Suno brief for a sung version is in `design/video/suno.md`. Guardrail: the "scanned" site is made up (`SITE` in `src/theme.ts`). Don't put real brands, logos or copy in the video.
