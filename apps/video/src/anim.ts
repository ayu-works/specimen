import { createContext, useContext } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { toDesign, VARIANTS, type Variant } from './timeline';

/** The variant being rendered (its speed scales the clock; flags toggle extras). */
export const VariantContext = createContext<Variant>(VARIANTS[0] as Variant);
export const useVariant = () => useContext(VariantContext);

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 0→1 over [start, start+dur]. */
export const prog = (t: number, start: number, dur: number) => clamp01((t - start) / dur);

export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const easeIn = (x: number) => x * x * x;
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** Overshoots past 1, then settles. */
export const easeBack = (x: number, k = 2.2) => 1 + (k + 1) * (x - 1) ** 3 + k * (x - 1) ** 2;

/** Pop-in scale: 0 → overshoot → 1. */
export const pop = (t: number, start: number, dur = 0.3) => {
  const p = prog(t, start, dur);
  return p <= 0 ? 0 : easeBack(p);
};

/** Slam-in scale: big → 1, with a small overshoot below 1. */
export const slam = (t: number, start: number, from = 2.4, dur = 0.16) => {
  const p = prog(t, start, dur);
  if (t < start) return 0;
  if (p < 1) return from + (1 - from) * easeIn(p);
  const q = prog(t, start + dur, 0.14);
  return 1 - 0.06 * Math.sin(q * Math.PI);
};

/** Decaying camera shake (px) after `start`. */
export const shake = (t: number, start: number, amp = 14, decay = 0.18) => {
  const x = t - start;
  if (x < 0 || x > decay * 4) return { x: 0, y: 0 };
  const a = amp * Math.exp(-x / decay);
  return { x: a * Math.sin(x * 97), y: a * Math.cos(x * 71) };
};

/** Step a value so motion reads as pixel-art (snaps to n fps). */
export const stepped = (t: number, fps = 12) => Math.floor(t * fps) / fps;

/** Deterministic pseudo-random in [0, 1). */
export const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Global time in design seconds (the timeline's clock, mapped through the variant's speeds). */
export const useTime = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return toDesign(useContext(VariantContext), frame / fps);
};

export type Layout = { W: number; H: number; wide: boolean; tall: boolean; min: number };
export const useLayout = (): Layout => {
  const { width: W, height: H } = useVideoConfig();
  return { W, H, wide: W > H, tall: H > W, min: Math.min(W, H) };
};

/** Pick a value per aspect ratio: [wide 16:9, square 1:1, tall 9:16]. */
export const pick = <T>(L: Layout, wide: T, square: T, tall: T): T =>
  L.wide ? wide : L.tall ? tall : square;
