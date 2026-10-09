# Reference video analysis: Shotcandy promo

Source: `vidssave.com Make Your Screenshots Look Amazing _ Shotcandy (Free Tool) 720P.mp4` (repo root, untracked).
Specs: **30.0 s, 1280×720, 16:9, stereo AAC 44.1 kHz.**
Contact sheets (one frame every 0.5 s) were made locally in `design/video/ref/` (gitignored: third-party frames). The reference's lyrics are deliberately not transcribed here; `suno.md` has our own.

## 1. The idea in one line
A grey, "boring" screenshot gets pasted into a candy factory. A mascot runs the show, the screenshot is restyled on every beat, and the video ends on the same grey shot plus the punchline "Candy shot!". It's a **before → machine → after** loop that **fires on the beat**.

## 2. Structure (beat map)
The music is about **125 BPM** (one beat ≈ 0.48 s, one bar ≈ 1.92 s). Almost every cut lands on a beat, and many on half-bars.

| Time | Scene | What happens | Device |
|---|---|---|---|
| 0.0–1.4 | **Cold open** | Grey dot-matrix screenshot, cursor, a short typed question as the caption, with a blinking caret | Desaturated, quiet. The only sound is typing ticks |
| 1.5 | **Drop** | A two-word imperative slams in letter by letter, giant ⌘ + V keycaps, starburst | Colour explodes on the downbeat |
| 2.0–2.9 | Mascot intro | Candy mascot waves a peace sign and holds a ⌘ key. JP katakana stickers (キャンディ ペースト) | Character + kinetic type |
| 3.0–3.9 | **The machine** | Conveyor belt with 4 stations: PAD ▸ ROUND ▸ SHADOW ▸ TILT. Caption chip lists them | Explains the feature as a factory |
| 4.0–5.9 | Station close-ups | One station per beat. A burst label (PAD/ROUND/SHADOW/TILT) and a gauge needle, while the screenshot gets that treatment | **1 feature = 1 beat**. HUD counter ticks 01→04 |
| 6.0–6.9 | Logo sting | Wordmark in a sticker box, vertical JP label, mascot pops in | Brand beat |
| 7.0 | Stage | Mascot plus device-mascots (phone, browser, tablet, laptop) on a concert stage | Shows breadth |
| 7.5–9.0 | Karaoke line 1 | Mascot stomps a giant ⌘ key, then V. A one-line sung subtitle **highlights word by word** | Lyrics sync to the vocal |
| 9.5 | Gumball machine | Mascot cheers, a gumball machine full of frame "candies", "S 36" counter | Shows the count of styles |
| 10.0–11.0 | Rapid restyles | PINK → macOS window → tablet frame. Background colour flips each beat. A sung subtitle names the styles as they appear | Fast cuts, label stickers |
| 11.5–12.0 | "SHUFFLE!" | Mascot slams the S key on the machine | Keyboard shortcut as a story beat |
| 12.5–13.0 | Randomize title | Slot-machine reel beside the screenshot, frames spin, text types in | Randomize feature |
| 13.5–15.0 | Annotate | 3D tilt, "this!" hand-drawn arrow plus highlight box, then the rest **pixel-blurs** away. A sung subtitle lists the three actions | Feature demo |
| 15.5–16.0 | Export-sizes title | Ruler/grid canvas, size chips "X · 1920×1080", "LinkedIn · 1200×1200", "fits ✓" badge | Export presets |
| 16.5–17.0 | Payoff title | Mascot hugs the framed screenshot, hearts, stars | Emotional beat |
| 17.5–18.0 | Wrap it | The screenshot becomes a phone, then a **wrapped candy** (くるむ = "wrap") | Brand metaphor |
| 18.5–19.5 | Chorus: the hook as two stacked slams | Paint splats, colour-cycling frame, text slams | Chorus: maximum energy |
| 20.0–20.5 | Mascot sings into a mic → "SHOT CANDY" on stage | | Confirms the vocal track |
| 21.0 | Loop title | Looping arrows around stacked frames | |
| 21.5–22.5 | Trust beat | Fake "Sign up" and "upload.exe" windows get stamped **NO SIGN UP / NO UPLOAD**. Stickers "100% LOCAL", "NO CLOUD", "ログイン不要" (no login needed) | Privacy pitch as rubber stamps |
| 23.0–23.5 | FREE / FAST | Mascot marches with the device crew, stamps FREE and FAST | |
| 24.0–25.5 | Sugar | Mascot sprinkles sugar on the screenshot. Sticky-note joke and a title card | |
| 26.0–26.5 | Gallery | **G** key: a wall of 36 framed variants zooms out into a grid | Payoff: volume |
| 27.0–27.5 | **Callback** | Back to the grey cold open and its question | Bookend |
| 28.0 | Punchline | The answer to the opening question, next to a polaroid of the mascot | |
| 28.5–30.0 | End card | Wordmark, URL pill, "Free · Open source · Runs in your browser", GitHub URL, mascot winks, filmstrip of variants scrolls along the bottom. Audio fades out at 29 s | CTA |

**Persistent HUD:** a small pill in the top right, "● STYLES 00/36". It counts up through the whole video (00 → 36) and gives a sense of progress and abundance.

## 3. Visual language
- **Style:** 90s anime / pop-art sticker collage. Thick black outlines, offset hard shadows, halftone dots, radiating sunburst stripes, paper grain, confetti, 4-point sparkles.
- **Palette:** off-white paper base (#F3EEE6-ish), candy pink as hero, plus yellow, mint/teal, purple, sky blue, orange. Every scene uses 2–3 of them at full saturation. The cold open is the only grey scene.
- **Type:** chunky condensed display caps with a yellow fill, a thick dark outline, a pink or 3D offset shadow, slight rotation. Letters slam in one by one with overshoot. Subtitles sit in a rounded white pill with a black border, and the active word is highlighted on a pink chip (karaoke).
- **Stickers:** taped labels, JP katakana side-tabs, starburst "explosion" badges for feature names, rubber stamps for claims.
- **Product footage:** the real UI (an analytics dashboard) is shown small and clean inside the stylized world, so it stays readable. The world is loud and the product is calm.
- **Motion:** snappy ease-out with overshoot, squash/stretch on the mascot, shake/impact frames on slams, whip pans and hard cuts on beats, no slow dissolves. Shot length is 0.5–1 s. The longest hold is about 1.5 s.

## 4. Sound
Measured from the waveform (loudness per second, onset detection, autocorrelation):
- **Tempo ≈ 125 BPM.** Steady onsets 0.48 s apart from 1.5 s to 15 s, then mostly bar-level hits (19.4, 21.3, 23.3 = 1.93 s apart).
- **0–1.4 s:** quiet (−27 dB) and bright/clicky. This is the typing ticks under the opening question. No music yet.
- **1.5 s: the drop.** Loudness jumps 13 dB and full music comes in on the title slam.
- **Dips at 7.5–8.5 s and 15.5–17 s** (−17 to −20 dB): breakdowns before the next section. Scene changes line up with them (stage → karaoke, every feed → looking its best).
- **18.5–24 s:** brighter and denser. This is the chorus.
- **29 s:** hard fade to −46 dB under the end card.
- **Vocals:** a sung jingle (word-synced karaoke subtitles, the mascot singing into a mic). Style: upbeat J-pop / kawaii pop, most likely AI-generated.
- **SFX (inferred from visuals and onsets):** key-press clacks on ⌘/V/S/G, whooshes on whip pans, pops/boings on mascot entrances, stamp thuds, a slot-machine whirr on "never the same", sparkle chimes.

## 5. Why it works
1. **The hook is a question** and the ending answers it.
2. **Every feature gets one beat and one word** (PAD, ROUND, SHADOW, TILT, SHUFFLE, BLUR, EVERY FEED). There are no paragraphs.
3. **Keyboard keys are the story beats** (⌘V, S, G). The UI is taught by rhythm.
4. **One metaphor carried all the way through** (candy factory → wrapped candy → sugar).
5. **Trust claims are shown as physical stamps**, not written as copy.
6. **The HUD counter** gives a 30-second ad a sense of progress.

## 6. Translating it to Specimen (proposal, to confirm)
| Shotcandy | Specimen equivalent |
|---|---|
| Candy factory metaphor | **Specimen lab**: a website goes under a loupe/microscope and gets "dissected" into colours, type, spacing, radii, shadows |
| Opening question → punchline answer | "love this site?" (grey site) → **"NOW IT'S A SPEC!"** |
| PAD ▸ ROUND ▸ SHADOW ▸ TILT stations | COLORS ▸ TYPE ▸ SPACING ▸ RADII ▸ SHADOWS, one per beat, with real swatches and scales pulled from our footage |
| ⌘V / S / G keys | Alt+Shift+C (scan), then copy Prompt / DESIGN.md |
| "STYLES 00/36" HUD | "● TOKENS 000/148" counting up during the scan |
| NO SIGN UP / NO UPLOAD stamps | **NO ACCOUNT · NO SERVER · NO TELEMETRY · OPEN SOURCE** stamps (all true) |
| Device crew | The pixel critter's moods (idle, scanning, happy, thinking, sad) as the "cast" |
| Illustrated pop-art style | Keep the energy (sunbursts, halftone, slams, stickers) but render it **pixel / 8-bit** to match our critter and wordmark. Purple #7C6CF5 is the hero. Tuft colours are the accents, on #0e0e16 or paper |
| J-pop vocal jingle | **Chiptune** at about 125 BPM, synthesized in code, plus SFX. Vocals are optional (see the open questions) |
| End card | Pixel wordmark, "Free · Open source · Runs in your browser", github.com/ayu-works/specimen, critter waves |

Guardrails carry over: no real brand names, logos or headline copy from scanned sites. Mask the footage the same way the store images do.

## 7. Open questions
- Length: a 30 s hero only, or also a 6–10 s loop for the site and store?
- Vocals: instrumental chiptune only (fully generated in code), or a sung hook made elsewhere (e.g. Suno) that we sync to?
- Aspect ratios: 16:9 only, or also 1:1 / 9:16 cuts for social?
