import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Composition } from 'remotion';
import { describe, expect, it, vi } from 'vitest';
import { Root } from '../src/Root';
import { BEAT, DURATION, FPS, SCENES, sceneRange, toReal, VARIANTS } from '../src/timeline';

// The scenes load fonts and audio; this test only needs the registration metadata.
vi.mock('../src/Main', () => ({ Main: () => null }));
// Lets the test check that src/index.ts registers the same Root it walks.
vi.mock('remotion', async (orig) => ({
  ...(await orig<typeof import('remotion')>()),
  registerRoot: vi.fn(),
}));

/**
 * The spec, written out by hand (not recomputed with `framesFor`): each cut's on-screen
 * length in seconds. See src/timeline.ts and the README for where these come from.
 */
const CUT_SECONDS: Record<string, number> = {
  '30s': 30, // speed 1
  '40s': 30 / 0.75, // speed 0.75 → 40 s
  suno: 30 / (105.04 / 120), // speed = song BPM / 120 → ≈ 34.273 s
  mix: 2 / 0.6 + 28, // 2 s cold open at 0.6×, then 28 s at speed 1 → ≈ 31.333 s
};
const FORMAT_SIZE: Record<string, [number, number]> = {
  '16x9': [1920, 1080],
  '1x1': [1080, 1080],
  '9x16': [1080, 1920],
};
const EXPECTED_FPS = 30;

type Comp = {
  id: string;
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
  defaultProps?: { variant?: string; audio?: string };
  /** Overrides fps/duration at render time, so the static props would no longer be the truth. */
  calculateMetadata?: unknown;
};
type Expected = { id: string; cut: string; frames: number; width: number; height: number };

const EXPECTED: Expected[] = Object.entries(CUT_SECONDS).flatMap(([cut, s]) =>
  Object.entries(FORMAT_SIZE).map(([f, [width, height]]) => ({
    id: `Promo${cut}-${f}`,
    cut,
    frames: Math.round(s * EXPECTED_FPS),
    width,
    height,
  })),
);

/** Every <Composition> that Root registers; anything else in its tree is an error. */
function readCompositions(): { found: Comp[]; errors: string[] } {
  const found: Comp[] = [];
  const errors: string[] = [];
  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node == null || typeof node === 'boolean') return;
    if (!isValidElement(node)) {
      errors.push(`unexpected node: ${String(node)}`);
      return;
    }
    const el = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
    const name =
      typeof el.type === 'string' ? el.type : String((el.type as { name?: string }).name);
    // A Fragment's type is a symbol; walk into it. Anything else (a Folder, a wrapper) is an error.
    if (el.type === Composition) found.push(el.props as unknown as Comp);
    else if (typeof el.type === 'symbol') walk(el.props.children);
    else errors.push(`unexpected element in Root: ${name}`);
  };
  walk(Root());
  return { found, errors };
}

/** Compares registered compositions against the hand-written spec; returns every mismatch. */
function checkCompositions(found: Comp[], expected: Expected[]): string[] {
  const errors: string[] = [];
  const ids = found.map((c) => c.id);
  for (const id of new Set(ids)) {
    if (ids.filter((x) => x === id).length > 1) errors.push(`${id}: registered twice`);
  }
  for (const e of expected) {
    if (!ids.includes(e.id)) errors.push(`${e.id}: missing`);
  }
  for (const c of found) {
    const e = expected.find((x) => x.id === c.id);
    if (!e) {
      errors.push(`${c.id}: not in the spec table`);
      continue;
    }
    if (c.calculateMetadata != null) {
      errors.push(
        `${c.id}: has calculateMetadata, so its rendered fps/duration aren't the checked props`,
      );
    }
    if (c.fps !== EXPECTED_FPS) errors.push(`${c.id}: fps ${c.fps}, expected ${EXPECTED_FPS}`);
    if (!Number.isInteger(c.durationInFrames) || c.durationInFrames <= 0) {
      errors.push(`${c.id}: durationInFrames ${c.durationInFrames} is not a positive integer`);
    }
    if (c.durationInFrames !== e.frames) {
      errors.push(`${c.id}: ${c.durationInFrames} frames, expected ${e.frames} (fps × duration)`);
    }
    if (c.width !== e.width || c.height !== e.height) {
      errors.push(`${c.id}: ${c.width}×${c.height}, expected ${e.width}×${e.height}`);
    }
    if (c.defaultProps?.variant !== e.cut) {
      errors.push(`${c.id}: variant ${c.defaultProps?.variant}, expected ${e.cut}`);
    }
    if (c.defaultProps?.audio !== `audio-${e.cut}.wav`) {
      errors.push(`${c.id}: audio ${c.defaultProps?.audio}, expected audio-${e.cut}.wav`);
    }
  }
  return errors;
}

describe('T7.04 Remotion compositions: frame count = fps × duration', () => {
  it('T7.04 src/index.ts registers the Root this test reads', async () => {
    const { registerRoot } = await import('remotion');
    await import('../src/index');
    expect(registerRoot).toHaveBeenCalledTimes(1);
    expect(registerRoot).toHaveBeenCalledWith(Root);
  });

  it('T7.04 every registered composition matches the spec table, without rendering', () => {
    const { found, errors } = readCompositions();
    expect(errors).toEqual([]);
    expect(found).toHaveLength(EXPECTED.length); // 4 cuts × 3 formats = 12
    expect(checkCompositions(found, EXPECTED)).toEqual([]);
  });

  it('T7.04 the timeline (used for the audio length too) agrees with the spec within 1 frame', () => {
    expect(FPS).toBe(EXPECTED_FPS);
    expect(VARIANTS.map((v) => v.id).sort()).toEqual(Object.keys(CUT_SECONDS).sort());
    for (const v of VARIANTS) {
      const drift = Math.abs(toReal(v, DURATION) - (CUT_SECONDS[v.id] as number)) * EXPECTED_FPS;
      expect(drift, `${v.id}: timeline vs spec, in frames`).toBeLessThanOrEqual(1);
    }
  });

  it('T7.04 the scenes fit inside the film, so no cut is cut short', () => {
    const starts = SCENES.map(([, t]) => t);
    expect(starts[0]).toBe(0);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i], `scene ${SCENES[i]?.[0]} starts after the previous one`).toBeGreaterThan(
        starts[i - 1] as number,
      );
    }
    const [lastId] = SCENES[SCENES.length - 1] as [Parameters<typeof sceneRange>[0], number];
    const [lastStart, lastEnd] = sceneRange(lastId);
    // sceneRange ends the last scene at DURATION by definition; the real risk is that it's too short.
    expect(lastEnd - lastStart, 'the last scene runs at least one bar').toBeGreaterThanOrEqual(
      4 * BEAT,
    );
    // And in real frames, the last scene starts before each cut's final frame.
    for (const v of VARIANTS) {
      const frames = Math.round((CUT_SECONDS[v.id] as number) * EXPECTED_FPS);
      expect(Math.round(toReal(v, lastStart) * EXPECTED_FPS)).toBeLessThan(frames);
    }
  });

  describe('T7.04 the check fails on a broken composition', () => {
    // Built from the spec, not from Root, so these cases test the checker on its own.
    const good = (): Comp[] =>
      EXPECTED.map((e) => ({
        id: e.id,
        fps: EXPECTED_FPS,
        durationInFrames: e.frames,
        width: e.width,
        height: e.height,
        defaultProps: { variant: e.cut, audio: `audio-${e.cut}.wav` },
      }));

    it('T7.04 a correct set has no errors', () => {
      expect(checkCompositions(good(), EXPECTED)).toEqual([]);
    });
    const first = EXPECTED[0] as Expected;

    it('T7.04 one frame off', () => {
      const comps = good();
      const c = comps.find((x) => x.id === first.id) as Comp;
      c.durationInFrames += 1;
      expect(checkCompositions(comps, EXPECTED)).toEqual([
        `${first.id}: ${first.frames + 1} frames, expected ${first.frames} (fps × duration)`,
      ]);
    });

    it('T7.04 wrong fps', () => {
      const comps = good();
      (comps.find((x) => x.id === first.id) as Comp).fps = 25;
      expect(checkCompositions(comps, EXPECTED)).toEqual([`${first.id}: fps 25, expected 30`]);
    });

    it('T7.04 fractional frame count', () => {
      const comps = good();
      (comps.find((x) => x.id === first.id) as Comp).durationInFrames = first.frames + 0.5;
      expect(checkCompositions(comps, EXPECTED)).toContain(
        `${first.id}: durationInFrames ${first.frames + 0.5} is not a positive integer`,
      );
    });

    it('T7.04 calculateMetadata overriding the duration is caught', () => {
      const comps = good();
      (comps.find((x) => x.id === first.id) as Comp).calculateMetadata = () => ({
        durationInFrames: 1,
        fps: 25,
      });
      expect(checkCompositions(comps, EXPECTED)).toEqual([
        `${first.id}: has calculateMetadata, so its rendered fps/duration aren't the checked props`,
      ]);
    });

    it('T7.04 a missing, an extra and a duplicate composition', () => {
      const comps = good().filter((x) => x.id !== first.id);
      comps.push({ ...(comps[0] as Comp), id: 'Promo99s-16x9' });
      comps.push({ ...(comps[0] as Comp) });
      const errors = checkCompositions(comps, EXPECTED);
      expect(errors).toContain(`${first.id}: missing`);
      expect(errors).toContain('Promo99s-16x9: not in the spec table');
      expect(errors).toContain(`${(comps[0] as Comp).id}: registered twice`);
    });
  });
});
