/**
 * Synthesizes the promo soundtrack (chiptune music + SFX) from the shared timeline
 * and writes public/audio.wav. Deterministic: same code, same file.
 *
 *   pnpm -F @specimen/video music
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  at,
  BEAT,
  DURATION,
  INTRO,
  LYRICS,
  SFX,
  type SfxKind,
  toReal,
  VARIANTS,
} from '../src/timeline';

const SR = 44100;
// Which cut to score: `tsx scripts/music.ts 30s` or `40s`.
const V =
  VARIANTS.find((v) => v.id === process.argv[2]) ?? (VARIANTS[0] as (typeof VARIANTS)[number]);
// Event times below are design seconds; `real()` maps them onto the variant's film.
// Musical note lengths stretch with the tempo; drum and SFX shapes keep their snap.
// Times map through the variant (the cold open may have its own speed); durations
// after the drop just scale by the main speed.
const real = (s: number) => toReal(V, s);
const realDur = (d: number) => d / V.speed;
const REAL_DURATION = real(DURATION);
const N = Math.ceil(REAL_DURATION * SR);
const EIGHTH = BEAT / 2;
const SIXTEENTH = BEAT / 4;

type Bus = { l: Float32Array; r: Float32Array };
const bus = (): Bus => ({ l: new Float32Array(N), r: new Float32Array(N) });
const music = bus(); // drums, bass
const pump = bus(); // arp + pad, ducked by the kick
const lead = bus(); // lead voice, gets an echo
const sfx = bus();
const duck = new Float32Array(N).fill(1);

let seed = 7;
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return (seed / 4294967296) * 2 - 1;
};
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Render `fn` (seconds since start → sample) into a bus with equal-power pan. */
function add(
  b: Bus,
  t0: number,
  len: number,
  gain: number,
  pan: number,
  fn: (t: number) => number,
) {
  const i0 = Math.round(real(t0) * SR);
  const n = Math.round(len * SR);
  const a = ((pan + 1) * Math.PI) / 4;
  const gl = gain * Math.cos(a) * Math.SQRT2;
  const gr = gain * Math.sin(a) * Math.SQRT2;
  for (let i = 0; i < n; i++) {
    const k = i0 + i;
    if (k < 0 || k >= N) continue;
    const v = fn(i / SR);
    b.l[k] = (b.l[k] ?? 0) + v * gl;
    b.r[k] = (b.r[k] ?? 0) + v * gr;
  }
}

/** One-pole lowpass as a stateful closure. */
const lowpass = () => {
  let y = 0;
  return (x: number, cutoff: number) => {
    const k = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    y += k * (x - y);
    return y;
  };
};
const highpass = () => {
  const lp = lowpass();
  return (x: number, cutoff: number) => x - lp(x, cutoff);
};

type Wave = 'pulse' | 'tri' | 'saw';
type NoteOpts = {
  wave: Wave;
  gain: number;
  pan?: number;
  duty?: number;
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  vib?: number;
  cutoff?: number;
  slideFrom?: number;
};

/** A synth note with an ADSR envelope; `dur` is the held time before release. */
function note(b: Bus, t: number, designDur: number, midi: number, o: NoteOpts) {
  const dur = realDur(designDur);
  // Synth parts follow the variant's key; SFX keep their own pitch.
  const shift = b !== sfx ? (V.transpose ?? 0) : 0;
  midi += shift;
  const slideFrom = o.slideFrom !== undefined ? o.slideFrom + shift : undefined;
  const { a = 0.004, d = 0.1, s = 0.6, r = 0.05, duty = 0.25, vib = 0, cutoff = 6000 } = o;
  const f0 = mtof(midi);
  let phase = 0;
  const lp = lowpass();
  add(b, t, dur + r, o.gain, o.pan ?? 0, (x) => {
    const slide = slideFrom !== undefined ? Math.max(0, 1 - x / 0.04) : 0;
    const base = slideFrom !== undefined ? f0 * (mtof(slideFrom) / f0) ** slide : f0;
    const f = base * (1 + vib * Math.sin(2 * Math.PI * 5.5 * x) * Math.min(1, x / 0.15));
    phase = (phase + f / SR) % 1;
    let v: number;
    if (o.wave === 'pulse') v = phase < duty ? 1 : -1;
    else if (o.wave === 'saw') v = 2 * phase - 1;
    else v = Math.round((1 - 4 * Math.abs(phase - 0.5)) * 7.5) / 7.5; // 4-bit triangle
    let env: number;
    if (x < a) env = x / a;
    else if (x < a + d) env = 1 - ((1 - s) * (x - a)) / d;
    else if (x < dur) env = s;
    else env = s * Math.max(0, 1 - (x - dur) / r);
    return lp(v, cutoff) * env;
  });
}

// ---------------------------------------------------------------- harmony

type Chord = { bass: number; tones: [number, number, number] };
const C: Chord = { bass: 36, tones: [60, 64, 67] };
const G: Chord = { bass: 43, tones: [59, 62, 67] };
const Am: Chord = { bass: 45, tones: [60, 64, 69] };
const F: Chord = { bass: 41, tones: [60, 65, 69] };
const CHORDS: Chord[] = [C, G, Am, F, C, G, Am, F, F, G, C, Am, F, C];

// Lead hook per chord, as [eighth step, midi, length in eighths].
type Phrase = [number, number, number][];
const HOOK = new Map<Chord, Phrase>([
  [
    C,
    [
      [0, 76, 1],
      [1, 79, 1],
      [2, 81, 1],
      [3, 79, 1],
      [4, 76, 2],
      [6, 72, 1],
      [7, 74, 1],
    ],
  ],
  [
    G,
    [
      [0, 74, 1],
      [1, 79, 1],
      [2, 83, 1],
      [3, 81, 1],
      [4, 79, 2],
      [6, 74, 1],
      [7, 76, 1],
    ],
  ],
  [
    Am,
    [
      [0, 72, 1],
      [1, 76, 1],
      [2, 81, 1],
      [3, 79, 1],
      [4, 76, 2],
      [6, 72, 1],
      [7, 76, 1],
    ],
  ],
  [
    F,
    [
      [0, 77, 1],
      [1, 81, 1],
      [2, 84, 1],
      [3, 81, 1],
      [4, 79, 4],
    ],
  ],
]);
const CHORUS: Phrase[] = [
  [
    [0, 84, 1.5],
    [2, 84, 1],
    [3, 81, 1],
    [4, 84, 2],
    [6, 86, 1],
    [7, 88, 1],
  ],
  [
    [0, 86, 1.5],
    [2, 86, 1],
    [3, 83, 1],
    [4, 86, 3],
    [7, 84, 1],
  ],
];

const leadNote = (t: number, len: number, midi: number, gain = 0.15) => {
  note(lead, t, len * 0.92, midi, {
    wave: 'pulse',
    duty: 0.25,
    gain,
    vib: 0.006,
    d: 0.12,
    s: 0.7,
    r: 0.08,
    cutoff: 5200,
  });
  // A quiet octave-down square thickens the "voice".
  note(lead, t, len * 0.92, midi - 12, {
    wave: 'pulse',
    duty: 0.5,
    gain: gain * 0.35,
    d: 0.1,
    s: 0.6,
    r: 0.08,
    cutoff: 2500,
  });
};
const playPhrase = (bar: number, p: Phrase, gain?: number) => {
  for (const [step, midi, len] of p) leadNote(at(bar) + step * EIGHTH, len * EIGHTH, midi, gain);
};

// ---------------------------------------------------------------- drums

function kick(t: number, gain = 0.55) {
  let phase = 0;
  add(music, t, 0.3, gain, 0, (x) => {
    const f = 45 + 110 * Math.exp(-x / 0.03);
    phase += f / SR;
    return Math.sin(2 * Math.PI * phase) * Math.exp(-x / 0.12) + (x < 0.003 ? rnd() * 0.5 : 0);
  });
  // Sidechain: the arp and pad dip under every kick.
  const i0 = Math.round(real(t) * SR);
  for (let i = 0; i < 0.3 * SR && i0 + i < N; i++) {
    const k = i0 + i;
    duck[k] = Math.min(duck[k] ?? 1, 1 - 0.6 * Math.exp(-i / SR / 0.09));
  }
}
function snare(t: number, gain = 0.24) {
  const hp = highpass();
  let phase = 0;
  add(music, t, 0.22, gain, 0.05, (x) => {
    phase += 190 / SR;
    return (
      hp(rnd(), 1200) * Math.exp(-x / 0.06) +
      0.6 * Math.sin(2 * Math.PI * phase) * Math.exp(-x / 0.035)
    );
  });
}
function hat(t: number, open = false, gain = 0.07) {
  const hp = highpass();
  add(
    music,
    t,
    open ? 0.25 : 0.05,
    gain,
    -0.3,
    (x) => hp(rnd(), 7000) * Math.exp(-x / (open ? 0.09 : 0.015)),
  );
}
function crash(t: number, gain = 0.12) {
  const hp = highpass();
  add(music, t, 1.6, gain, 0.2, (x) => hp(rnd(), 4500) * Math.exp(-x / 0.45));
}

// ---------------------------------------------------------------- arrangement

for (let b = 0; b < CHORDS.length; b++) {
  const ch = CHORDS[b] as Chord;
  const t0 = at(b);
  const full = [0, 1, 2, 4, 5, 6, 8, 9, 10, 11].includes(b);

  // Drums
  if (full) {
    for (let beat = 0; beat < 4; beat++) {
      if (V.doubleTime) {
        // Double-time: kick and snare alternate every half design-beat (180 BPM feel).
        kick(at(b, beat));
        snare(at(b, beat + 0.5), 0.2);
        hat(at(b, beat + 0.25));
        hat(at(b, beat + 0.75), b >= 8 && beat === 3);
        if (b >= 8) for (const q of [0.125, 0.375, 0.625, 0.875]) hat(at(b, beat + q), false, 0.03);
      } else {
        kick(at(b, beat));
        if (beat % 2 === 1) snare(at(b, beat));
        hat(at(b, beat + 0.5), b >= 8 && beat === 3);
        if (b >= 8) hat(at(b, beat + 0.25), false, 0.035);
      }
    }
  }
  if ([0, 4, 8, 10].includes(b)) crash(t0);
  if (b === 3) kick(t0, 0.6);
  if (b === 7) {
    // Breakdown: a snare roll builds into the chorus.
    for (let i = 0; i < 8; i++) snare(at(7, 2 + i * 0.25), 0.08 + i * 0.025);
  }
  if (b === 12) {
    kick(at(12, 0));
    kick(at(12, 1));
    snare(at(12, 1));
  }
  if (b === 13) {
    kick(t0, 0.6);
    crash(t0, 0.14);
  }

  // Bass: octave-bouncing 4-bit triangle eighths; long notes in the quiet bars.
  if (full) {
    // Double-time cut: sixteenths instead of eighths.
    const bassSteps = V.doubleTime ? 16 : 8;
    const bassStep = V.doubleTime ? SIXTEENTH : EIGHTH;
    for (let i = 0; i < bassSteps; i++) {
      const midi = ch.bass + (i % 2 === 1 ? 12 : 0);
      note(music, t0 + i * bassStep, bassStep * 0.8, midi, {
        wave: 'tri',
        gain: 0.32,
        d: 0.05,
        s: 0.8,
        r: 0.03,
      });
    }
  } else if (b === 3 || b === 7) {
    note(music, t0, BEAT * 3.8, ch.bass, { wave: 'tri', gain: 0.3, a: 0.01, s: 0.7, r: 0.2 });
  } else if (b === 12) {
    for (let i = 0; i < 4; i++)
      note(music, t0 + i * EIGHTH, EIGHTH * 0.8, F.bass + (i % 2) * 12, { wave: 'tri', gain: 0.3 });
  } else if (b === 13) {
    note(music, t0, BEAT * 3.5, C.bass, { wave: 'tri', gain: 0.32, s: 0.7, r: 0.5 });
  }

  // Arp: 16th-note chord tones, panned side to side.
  const dt = V.doubleTime ? 2 : 1;
  const arpSteps = (b === 12 ? 8 : 16) * dt;
  const arpStep = SIXTEENTH / dt;
  if (b !== 13) {
    for (let i = 0; i < arpSteps; i++) {
      const up = b === 12 ? Math.floor(i / (3 * dt)) * 12 : i % (8 * dt) >= 4 * dt ? 12 : 0;
      const midi = (ch.tones[i % 3] as number) + up;
      const muffled = b === 3 || b === 7;
      note(pump, t0 + i * arpStep, arpStep * 0.6, midi, {
        wave: 'pulse',
        duty: 0.125,
        gain: muffled ? 0.06 : 0.075,
        pan: i % 2 ? 0.45 : -0.45,
        d: 0.05,
        s: 0.4,
        r: 0.03,
        cutoff: muffled ? 1400 : 4200,
      });
    }
  }

  // Pad: soft detuned saws under everything after the drop (left out under a sung track).
  if (b !== 12 && !V.song?.blend) {
    for (const [i, m] of ch.tones.entries()) {
      for (const det of [-0.08, 0.08]) {
        note(pump, t0, BEAT * 4 - 0.02, m + det, {
          wave: 'saw',
          gain: 0.028,
          pan: (i - 1) * 0.5,
          a: 0.08,
          d: 0.3,
          s: 0.7,
          r: 0.15,
          cutoff: 1100,
        });
      }
    }
  }

  // Lead
  if (b <= 2 || b === 6 || b === 10 || b === 11) playPhrase(b, HOOK.get(ch) as Phrase);
  if (b === 8 || b === 9) {
    playPhrase(b, CHORUS[b - 8] as Phrase, 0.17);
    playPhrase(
      b,
      (CHORUS[b - 8] as Phrase).map(([s, m, l]) => [s, m - 5, l] as [number, number, number]),
      0.06,
    );
  }
}

// Sung karaoke lines: one lead note per word, slight scoop up like a voice.
for (const words of Object.values(LYRICS)) {
  for (const w of words) {
    note(lead, w.t, w.len * 0.9, w.note, {
      wave: 'pulse',
      duty: 0.25,
      gain: 0.16,
      vib: 0.008,
      slideFrom: w.note - 1,
      d: 0.12,
      s: 0.75,
      r: 0.1,
      cutoff: 5200,
    });
    note(lead, w.t, w.len * 0.9, w.note - 12, {
      wave: 'pulse',
      duty: 0.5,
      gain: 0.05,
      d: 0.1,
      s: 0.6,
      r: 0.1,
      cutoff: 2500,
    });
  }
}

// Logo sting (bar 3) and the end chord: a bell-like arpeggio.
for (const [i, m] of [72, 76, 79, 84, 88].entries()) {
  note(lead, at(3, 1) + i * 0.06, 0.5, m, { wave: 'tri', gain: 0.12, d: 0.4, s: 0.3, r: 0.3 });
}
// Punchline stab, then the final chord with a sparkle run.
for (const m of [60, 64, 67, 72])
  note(pump, at(12, 3), BEAT * 0.8, m, {
    wave: 'pulse',
    duty: 0.25,
    gain: 0.07,
    d: 0.2,
    s: 0.5,
    r: 0.1,
    cutoff: 4000,
  });
crash(at(12, 3), 0.1);
for (const m of [60, 64, 67, 72, 76])
  note(pump, at(13), BEAT * 2.6, m, {
    wave: 'pulse',
    duty: 0.25,
    gain: 0.05,
    a: 0.01,
    d: 0.5,
    s: 0.5,
    r: 0.6,
    cutoff: 3500,
  });
for (let i = 0; i < 12; i++) {
  note(lead, at(13, 0.5) + i * 0.09, 0.08, [84, 88, 91, 96][i % 4] as number, {
    wave: 'pulse',
    duty: 0.125,
    gain: 0.05 * (1 - i / 14),
    pan: i % 2 ? 0.6 : -0.6,
    d: 0.06,
    s: 0.2,
    r: 0.1,
  });
}

// ---------------------------------------------------------------- SFX

const SFX_RENDER: Record<SfxKind, (t: number, g: number) => void> = {
  tick: (t, g) => {
    const hp = highpass();
    let ph = 0;
    add(sfx, t, 0.05, 0.55 * g, rnd() * 0.3, (x) => {
      ph += (1800 + rnd() * 200) / SR;
      return (
        hp(rnd(), 2500) * Math.exp(-x / 0.008) +
        0.4 * Math.sin(2 * Math.PI * ph) * Math.exp(-x / 0.01)
      );
    });
  },
  clack: (t, g) => {
    const lp = lowpass();
    let ph = 0;
    add(sfx, t, 0.12, 0.6 * g, 0, (x) => {
      ph += (90 + 120 * Math.exp(-x / 0.015)) / SR;
      return (
        lp(rnd(), 3500) * Math.exp(-x / 0.012) +
        0.7 * Math.sin(2 * Math.PI * ph) * Math.exp(-x / 0.03)
      );
    });
  },
  slam: (t, g) => {
    const lp = lowpass();
    let ph = 0;
    add(sfx, t, 0.5, 0.75 * g, 0, (x) => {
      ph += (35 + 100 * Math.exp(-x / 0.05)) / SR;
      return (
        Math.sin(2 * Math.PI * ph) * Math.exp(-x / 0.18) +
        0.5 * lp(rnd(), 2500) * Math.exp(-x / 0.06)
      );
    });
  },
  whoosh: (t, g) => {
    const lp = lowpass();
    const len = 0.4;
    for (const side of [-1, 1]) {
      add(sfx, t - 0.15, len, 0.16 * g, side * 0.6, (x) => {
        const p = x / len;
        return (
          lp(rnd(), 400 + 4500 * Math.sin(Math.PI * p)) *
          Math.sin(Math.PI * p) ** 2 *
          (side < 0 ? 1 - p : p) *
          2
        );
      });
    }
  },
  pop: (t, g) => {
    let ph = 0;
    add(sfx, t, 0.12, 0.3 * g, 0, (x) => {
      ph += (300 * 3 ** Math.min(1, x / 0.05)) / SR;
      return Math.sin(2 * Math.PI * ph) * Math.exp(-x / 0.05);
    });
  },
  stamp: (t, g) => {
    const lp = lowpass();
    let ph = 0;
    add(sfx, t, 0.4, 0.85 * g, 0, (x) => {
      ph += (55 + 60 * Math.exp(-x / 0.02)) / SR;
      return (
        Math.sin(2 * Math.PI * ph) * Math.exp(-x / 0.12) +
        0.6 * lp(rnd(), 900) * Math.exp(-x / 0.04) +
        (x < 0.05 ? 0.2 * Math.sign(Math.sin(2 * Math.PI * 110 * x)) * (1 - x / 0.05) : 0)
      );
    });
  },
  sparkle: (t, g) => {
    [96, 100, 103, 108, 103, 108].forEach((m, i) => {
      note(sfx, t + i * 0.045, 0.03, m, {
        wave: 'pulse',
        duty: 0.25,
        gain: 0.07 * g,
        pan: i % 2 ? 0.5 : -0.5,
        d: 0.08,
        s: 0.1,
        r: 0.08,
      });
    });
  },
  blip: (t, g) =>
    note(sfx, t, 0.03, 91, { wave: 'pulse', duty: 0.5, gain: 0.06 * g, d: 0.02, s: 0.5, r: 0.02 }),
  riser: (t, g) => {
    const hp = highpass();
    let ph = 0;
    // Spans to the drop even when the cold open is slowed.
    const len = real(t + 0.5) - real(t);
    add(sfx, t, len, 0.2 * g, 0, (x) => {
      const p = x / len;
      ph += mtof(48 + 36 * p) / SR;
      return (0.6 * hp(rnd(), 2000) + 0.35 * (ph % 1 < 0.5 ? 1 : -1)) * p * p;
    });
  },
  scan: (t, g) => {
    let ph = 0;
    const len = realDur(0.5);
    add(sfx, t, len, 0.06 * g, 0, (x) => {
      ph += (800 + 1400 * (x / len)) / SR;
      return (ph % 1 < 0.5 ? 1 : -1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 24 * x)) * (1 - x / len);
    });
  },
  shutter: (t, g) => {
    const hp = highpass();
    add(
      sfx,
      t,
      0.08,
      0.35 * g,
      0,
      (x) =>
        hp(rnd(), 2500) * (Math.exp(-x / 0.006) + (x > 0.035 ? Math.exp(-(x - 0.035) / 0.008) : 0)),
    );
  },
};
// Cold-open room tone: faint vinyl crackle so the grey world isn't dead silent.
{
  const lp = lowpass();
  add(sfx, 0, real(at(0)), 1, 0, (x) => {
    const fade = Math.min(1, x / 0.3);
    const crackle = rnd() > 0.9985 ? rnd() * 0.25 : 0;
    return (0.012 * lp(rnd(), 900) + crackle) * fade;
  });
}
for (const e of SFX) SFX_RENDER[e.kind](e.t, e.gain ?? 1);

// ---------------------------------------------------------------- mix

// Lead echo: dotted-eighth delay, a little to each side.
const echo = Math.round(realDur(EIGHTH * 1.5) * SR);
for (let i = echo; i < N; i++) {
  lead.l[i] = (lead.l[i] ?? 0) + 0.28 * (lead.r[i - echo] ?? 0);
  lead.r[i] = (lead.r[i] ?? 0) + 0.28 * (lead.l[i - echo] ?? 0);
}

const mL = new Float32Array(N);
const mR = new Float32Array(N);
const blend = V.song?.blend ?? false;
if (!V.song || blend) {
  // Blended under a sung track, the synth makes room: the lead and arp step way back.
  const leadGain = blend ? 0.15 : 1;
  const pumpGain = blend ? 0.5 : 1;
  const synthGain = blend ? 0.75 : 1;
  for (let i = 0; i < N; i++) {
    const d = duck[i] ?? 1;
    mL[i] =
      ((music.l[i] ?? 0) + (pump.l[i] ?? 0) * d * pumpGain + (lead.l[i] ?? 0) * leadGain) *
      synthGain;
    mR[i] =
      ((music.r[i] ?? 0) + (pump.r[i] ?? 0) * d * pumpGain + (lead.r[i] ?? 0) * leadGain) *
      synthGain;
  }
  if (blend) {
    // Carve the vocal range (≈250 Hz–5 kHz) out of the synth; kick, bass and hats stay.
    for (const ch of [mL, mR]) {
      const low = lowpass();
      const high = highpass();
      for (let i = 0; i < N; i++) {
        const x = ch[i] ?? 0;
        const lo = low(x, 250);
        const hi = high(x, 5000);
        ch[i] = lo + hi + (x - lo - hi) * 0.3;
      }
    }
  }
}
if (V.song) {
  // The recorded song: replaces the synth music, or (blend) plays with it.
  const { offset, tempo = 1 } = V.song;
  const pcm = decodeSong(V.song.file, Math.max(0, offset), V.song.tempo);
  // A negative offset means the song starts that far (in song time) into the film.
  // Song time is anchored to the drop: a slowed cold open pushes the song later by the
  // extra intro time. A negative offset means the song starts that far into the film.
  const introShift = real(INTRO) - INTRO / V.speed;
  const startAt = Math.round(((offset < 0 ? -offset / tempo : 0) + introShift) * SR);
  const gateAt = Math.round((real(at(0)) - 0.06) * SR);
  const presLo = lowpass();
  const presHi = highpass();
  for (let i = startAt; i < N && (i - startAt) * 4 + 3 < pcm.length; i++) {
    const j = i - startAt;
    let l = pcm.readInt16LE(j * 4) / 32768;
    let r = pcm.readInt16LE(j * 4 + 2) / 32768;
    if (blend) {
      // Vocals sit in the centre: lift the mid, ease the sides, add presence (2–5 kHz).
      const mid = (l + r) / 2;
      const side = (l - r) / 2;
      const pres = presHi(presLo(mid, 5000), 2000);
      const m2 = mid * 1.2 + pres * 0.6;
      l = m2 + side * 0.7;
      r = m2 - side * 0.7;
    }
    // Blended: the song stays silent until just before the drop, so its spoken
    // intro is dropped and its first sound is "Scan it!" on the drop.
    const g = blend ? Math.min(1, Math.max(0, (i - gateAt) / (0.03 * SR))) : 1;
    mL[i] = (mL[i] ?? 0) + l * g;
    mR[i] = (mR[i] ?? 0) + r * g;
  }
}

// Tape stop into the grey callback: the music slows to a halt, then silence.
{
  const t0 = real(at(12, 2));
  const stop = realDur(0.4);
  const i0 = Math.round(t0 * SR);
  const end = Math.round(real(at(12, 3)) * SR);
  const srcL = mL.slice(i0, end);
  const srcR = mR.slice(i0, end);
  for (let k = i0; k < end; k++) {
    const x = (k - i0) / SR;
    if (x >= stop) {
      mL[k] = 0;
      mR[k] = 0;
      continue;
    }
    const pos = (x - (x * x) / (2 * stop)) * SR;
    const j = Math.floor(pos);
    const fr = pos - j;
    const amp = 1 - x / stop;
    mL[k] = ((srcL[j] ?? 0) * (1 - fr) + (srcL[j + 1] ?? 0) * fr) * amp;
    mR[k] = ((srcR[j] ?? 0) * (1 - fr) + (srcR[j + 1] ?? 0) * fr) * amp;
  }
}

const outL = new Float32Array(N);
const outR = new Float32Array(N);
// Under a sung track the SFX drop back so the vocal stays on top.
const musicGain = V.song ? (blend ? 0.85 : 1) : 0.85;
const sfxGain = V.song ? (blend ? 0.5 : 0.45) : 1;
// Less soft-clip drive when blended, so the vocal isn't squashed.
const drive = blend ? 1.0 : 1.3;
const fadeStart = real(29.0);
const fadeEnd = real(29.9);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / (fadeEnd - fadeStart));
  const l = Math.tanh(((mL[i] ?? 0) * musicGain + (sfx.l[i] ?? 0) * sfxGain) * drive) * fade;
  const r = Math.tanh(((mR[i] ?? 0) * musicGain + (sfx.r[i] ?? 0) * sfxGain) * drive) * fade;
  outL[i] = l;
  outR[i] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
const norm = 0.89 / (peak || 1); // about -1 dBFS

// 16-bit stereo WAV
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (outL[i] ?? 0) * norm)) * 32767), i * 4);
  data.writeInt16LE(
    Math.round(Math.max(-1, Math.min(1, (outR[i] ?? 0) * norm)) * 32767),
    i * 4 + 2,
  );
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', `audio-${V.id}.wav`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, data]));
console.log(`wrote ${out} (${REAL_DURATION}s, peak normalized)`);

/** Decode a song to 44.1 kHz stereo s16 PCM, starting `offset` seconds in. Uses Remotion's bundled ffmpeg. */
function decodeSong(file: string, offset: number, tempo?: number): Buffer {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const store = join(repo, 'node_modules', '.pnpm');
  const dir = existsSync(store)
    ? readdirSync(store).find((d) => d.startsWith('@remotion+compositor-'))
    : undefined;
  const pkg = dir
    ? join(
        store,
        dir,
        'node_modules',
        '@remotion',
        dir.split('@')[1]?.replace('remotion+', '') ?? '',
      )
    : '';
  const ffmpeg = pkg && existsSync(join(pkg, 'ffmpeg')) ? join(pkg, 'ffmpeg') : 'ffmpeg';
  // Remotion's ffmpeg build has no raw-PCM muxer, so decode to WAV and take its data chunk.
  const wav = execFileSync(
    ffmpeg,
    [
      '-v',
      'error',
      '-ss',
      String(offset),
      '-i',
      join(repo, file),
      ...(tempo ? ['-af', `atempo=${tempo}`] : []),
      '-c:a',
      'pcm_s16le',
      '-ac',
      '2',
      '-ar',
      String(SR),
      '-f',
      'wav',
      '-',
    ],
    { maxBuffer: 1 << 30, env: { ...process.env, DYLD_LIBRARY_PATH: pkg } },
  );
  let p = 12;
  while (p + 8 <= wav.length) {
    const id = wav.toString('ascii', p, p + 4);
    const size = wav.readUInt32LE(p + 4);
    if (id === 'data') return wav.subarray(p + 8);
    p += 8 + size + (size % 2);
  }
  throw new Error(`no audio data decoded from ${file}`);
}
