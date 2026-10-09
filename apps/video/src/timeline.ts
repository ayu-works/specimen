/**
 * The single clock for picture and sound. Both the Remotion scenes and
 * scripts/music.ts import these numbers, so every slam, key press and stamp
 * lands on the same frame as its sound.
 *
 * Everything below is in "design seconds": 120 BPM, a 2 s cold open, 30 s total.
 * A variant's `speed` stretches the whole film at render time. Picture and sound
 * both apply it, so they stay locked:
 * - 30s: speed 1, 120 BPM (one beat = 15 frames).
 * - 40s: speed 0.75, picture at 90 BPM (one beat = 20 frames). The drums, bass and
 *   arp play double-time (180 BPM feel), so it's slower to read but still driving.
 */
export const FPS = 30;
export const BPM = 120;
export const BEAT = 60 / BPM; // 0.5 s
export const INTRO = 2; // seconds of cold open before the drop
export const DURATION = 30; // design seconds

export type VariantId = '30s' | '40s' | 'suno' | 'mix';
export type Variant = {
  id: VariantId;
  speed: number;
  /** Speed of the grey cold open only (defaults to `speed`); 0.6 = 40% slower. */
  introSpeed?: number;
  doubleTime: boolean;
  /** Show the karaoke subtitles (off when a sung track isn't word-synced). */
  karaoke: boolean;
  /**
   * Use a recorded song instead of the synth music (SFX still mixed under it).
   * `offset` is where in the song the film starts, chosen so a song downbeat lands
   * on our drop. Speed = song BPM / 120 keeps every bar on a cut.
   */
  song?: {
    file: string;
    bpm: number;
    offset: number;
    /** Time-stretch the song by this factor (pitch kept), e.g. 120/105 to match our tempo. */
    tempo?: number;
    /** Keep the synth music and mix the song with it instead of replacing it. */
    blend?: boolean;
  };
  /** Shift the synth music by this many semitones (to match a song's key). */
  transpose?: number;
};
const SUNO_BPM = 105.04; // measured: bars at 0.32 + 2.285k s
export const VARIANTS: Variant[] = [
  { id: '30s', speed: 1, doubleTime: false, karaoke: true },
  { id: '40s', speed: 0.75, doubleTime: true, karaoke: true },
  {
    id: 'suno',
    speed: SUNO_BPM / BPM,
    doubleTime: false,
    karaoke: false,
    // The song's bar at 2.60 s lands on our drop (2 design s = 2.285 real s).
    song: {
      file: 'design/video/audio/specimen-suno.webm',
      bpm: SUNO_BPM,
      offset: 2.6 - INTRO / (SUNO_BPM / BPM),
    },
  },
  {
    // The 30 s cut as-is, with the Suno song sped up to 120 BPM and mixed with
    // the chiptune. The song is in F major, so the synth drops 7 semitones (C→F).
    id: 'mix',
    speed: 1,
    // The grey hook lingers: 40% slower (2 s → 3.33 s). Everything after the drop is unchanged.
    introSpeed: 0.6,
    doubleTime: false,
    karaoke: true,
    transpose: -7,
    song: {
      file: 'design/video/audio/specimen-suno.webm',
      bpm: SUNO_BPM,
      // The sung "Scan it!" starts on a beat at 1.19 s in the original: put it on our
      // drop. The band then enters 3 beats later, on the "IT!" slam, and the song's
      // spoken "Just a vibe?" lands over the grey cold open. Negative = song starts late.
      offset: 1.19 - INTRO * (BPM / 105),
      tempo: BPM / 105,
      blend: true,
    },
  },
];
export const FORMATS = [
  { id: '16x9', width: 1920, height: 1080 },
  { id: '1x1', width: 1080, height: 1080 },
  { id: '9x16', width: 1080, height: 1920 },
] as const;
/** Design seconds → on-screen seconds for a variant (the cold open may run at its own speed). */
export const toReal = (v: Variant, s: number) => {
  const intro = v.introSpeed ?? v.speed;
  return s <= INTRO ? s / intro : INTRO / intro + (s - INTRO) / v.speed;
};
/** On-screen seconds → design seconds (inverse of `toReal`). */
export const toDesign = (v: Variant, t: number) => {
  const intro = v.introSpeed ?? v.speed;
  const introReal = INTRO / intro;
  return t <= introReal ? t * intro : INTRO + (t - introReal) * v.speed;
};
export const framesFor = (v: Variant) => Math.round(toReal(v, DURATION) * FPS);

/** Seconds at bar `b`, beat `beat` (beats may be fractional). */
export const at = (b: number, beat = 0) => INTRO + (b * 4 + beat) * BEAT;
/** Seconds to frames. */
export const fr = (s: number) => Math.round(s * FPS);

export type SceneId =
  | 'cold'
  | 'drop'
  | 'critter'
  | 'lab'
  | 'stations'
  | 'logo'
  | 'measured'
  | 'roles'
  | 'prompt'
  | 'handoff'
  | 'build'
  | 'stage'
  | 'stamps'
  | 'free'
  | 'library'
  | 'callback'
  | 'punch'
  | 'end';

/** Scene start times in seconds; each runs until the next one starts. */
export const SCENES: [SceneId, number][] = [
  ['cold', 0],
  ['drop', at(0)],
  ['critter', at(1)],
  ['lab', at(1, 2)],
  ['stations', at(2)],
  ['logo', at(3, 1)],
  ['measured', at(4)],
  ['roles', at(5)],
  ['prompt', at(6)],
  ['handoff', at(7)],
  ['build', at(8)],
  ['stage', at(9)],
  ['stamps', at(10)],
  ['free', at(11)],
  ['library', at(12)],
  ['callback', at(12, 2)],
  ['punch', at(12, 3)],
  ['end', at(13)],
];

export const sceneRange = (id: SceneId): [number, number] => {
  const i = SCENES.findIndex(([s]) => s === id);
  const start = SCENES[i]?.[1] ?? 0;
  const end = SCENES[i + 1]?.[1] ?? DURATION;
  return [start, end];
};

/** Cold-open caption, typed one character at a time. Also used by the callback. */
export const TYPED = { text: 'love this site?', start: 0.35, step: 0.07 };
export const CALLBACK_TYPED = { text: TYPED.text, start: at(12, 2) + 0.02, step: 0.03 };

/** The five measuring stations, one beat each. */
export const STATIONS = ['COLORS', 'TYPE', 'SPACING', 'RADII', 'SHADOWS'] as const;
export const stationTime = (i: number) => at(2, i);

/** Karaoke lines: each word lights up on its beat, and the lead synth sings it. */
export type Word = { w: string; t: number; note: number; len: number };
const line = (bar: number, words: [string, number, number, number?][]): Word[] =>
  words.map(([w, beat, note, len]) => ({ w, t: at(bar, beat), note, len: len ?? 0.5 }));

// MIDI notes. Bar 4 = C, bar 5 = G, bar 7 = F (see music.ts CHORDS).
export const LYRICS: Record<'measured' | 'roles' | 'handoff', Word[]> = {
  measured: line(4, [
    ['Every', 0, 76],
    ['color,', 0.5, 79],
    ['every', 1, 76],
    ['size,', 1.5, 79],
    ['measured.', 2, 84, 1.5],
  ]),
  roles: line(5, [
    ['Every', 0, 74],
    ['swatch', 0.5, 79],
    ['gets', 1, 83],
    ['a', 1.5, 81],
    ['role.', 2, 79, 1.5],
  ]),
  handoff: line(7, [
    ['Hand', 0, 77],
    ['it', 0.5, 76],
    ['to', 1, 74],
    ['your', 1.5, 72],
    ['AI.', 2, 74, 1.5],
  ]),
};

export type SfxKind =
  | 'tick'
  | 'clack'
  | 'slam'
  | 'whoosh'
  | 'pop'
  | 'stamp'
  | 'sparkle'
  | 'blip'
  | 'riser'
  | 'scan'
  | 'shutter';

/** Every sound effect, with the visual that triggers it noted alongside. */
export const SFX: { t: number; kind: SfxKind; gain?: number }[] = [
  // Cold open: typing, then the shortcut and the riser into the drop.
  ...Array.from(TYPED.text, (_, i) => ({
    t: TYPED.start + i * TYPED.step,
    kind: 'tick' as const,
    gain: 0.8,
  })),
  { t: 1.5, kind: 'riser' },
  // Drop: Alt, Shift, C keycaps slam on beats 0-2, "SCAN IT!" on beat 3.
  { t: at(0, 0), kind: 'clack' },
  { t: at(0, 1), kind: 'clack' },
  { t: at(0, 2), kind: 'clack' },
  { t: at(0, 3), kind: 'slam' },
  // Critter hops in, then the scanner sweeps.
  { t: at(1, 0), kind: 'pop' },
  { t: at(1, 2), kind: 'whoosh' },
  { t: at(1, 2.25), kind: 'scan' },
  // Stations: one pop per measurement.
  ...STATIONS.map((_, i) => ({ t: stationTime(i), kind: 'pop' as const, gain: 0.7 })),
  { t: at(3, 1), kind: 'sparkle' },
  { t: at(4), kind: 'whoosh', gain: 0.6 },
  { t: at(5), kind: 'whoosh', gain: 0.6 },
  // Prompt: copy keys, then the DESIGN.md file lands.
  { t: at(6, 0), kind: 'clack' },
  { t: at(6, 0.5), kind: 'clack' },
  { t: at(6, 3), kind: 'pop' },
  { t: at(7), kind: 'whoosh', gain: 0.5 },
  { t: at(7, 2.5), kind: 'riser', gain: 0.8 },
  // Chorus.
  { t: at(8, 0), kind: 'slam' },
  { t: at(8, 2), kind: 'slam' },
  { t: at(9, 0), kind: 'whoosh' },
  // Trust stamps.
  { t: at(10, 1), kind: 'stamp' },
  { t: at(10, 2), kind: 'stamp' },
  { t: at(10, 3), kind: 'stamp' },
  { t: at(11, 0), kind: 'stamp' },
  { t: at(11, 2), kind: 'stamp' },
  // Library zoom-out, callback, punchline.
  { t: at(12, 0), kind: 'whoosh' },
  ...Array.from(CALLBACK_TYPED.text, (_, i) => ({
    t: CALLBACK_TYPED.start + i * CALLBACK_TYPED.step,
    kind: 'tick' as const,
    gain: 0.6,
  })),
  { t: at(12, 3), kind: 'shutter' },
  { t: at(12, 3), kind: 'slam' },
  { t: at(13, 0), kind: 'sparkle' },
];

/** HUD counter: measured values so far. Piecewise-linear over time. */
export const TOKENS_TOTAL = 148;
export const TOKEN_KEYS: [number, number][] = [
  [0, 0],
  [at(1, 2), 0],
  [at(2), 12],
  [at(2, 1), 38],
  [at(2, 2), 61],
  [at(2, 3), 79],
  [at(3, 0), 94],
  [at(3, 1), 103],
  [at(5), 118],
  [at(6), 131],
  [at(8), 140],
  [at(12), 146],
  [at(12, 2), TOKENS_TOTAL],
];
