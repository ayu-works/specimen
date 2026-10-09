import type { CSSProperties } from 'react';

/**
 * Specimen's critter, pixel for pixel the same as
 * apps/extension/src/components/Mascot.tsx (body, tuft, shine and the five moods).
 * Don't alter the art. Only position, scale and mood change in the video.
 */
export type Mood = 'idle' | 'scanning' | 'happy' | 'thinking' | 'sad';
type R = readonly [number, number, number, number];

const BODY = '#7C6CF5';
const SHINE = '#A99BFF';
const INK = '#1b1b2f';
const BLUSH = '#FF9FB8';
const TEAR = '#8FC1FF';

const BODY_RECTS: R[] = [
  [40, 16, 48, 8],
  [24, 24, 80, 8],
  [16, 32, 96, 8],
  [16, 40, 96, 8],
  [16, 48, 96, 8],
  [16, 56, 96, 8],
  [16, 64, 96, 8],
  [16, 72, 96, 8],
  [24, 80, 80, 8],
  [24, 88, 80, 8],
  [32, 96, 16, 8],
  [80, 96, 16, 8],
];
const TUFT: [number, string][] = [
  [48, '#FF6B6B'],
  [56, '#FFD166'],
  [64, '#06D6A0'],
  [72, '#4D96FF'],
];
const BLUSH_RECTS: R[] = [
  [24, 64, 8, 8],
  [96, 64, 8, 8],
];

const FACES: Record<Exclude<Mood, 'scanning'>, [R[], string][]> = {
  idle: [
    [
      [
        [32, 48, 8, 16],
        [88, 48, 8, 16],
        [56, 68, 16, 8],
      ],
      INK,
    ],
    [BLUSH_RECTS, BLUSH],
  ],
  happy: [
    [
      [
        [32, 48, 8, 8],
        [24, 56, 8, 8],
        [40, 56, 8, 8],
        [88, 48, 8, 8],
        [80, 56, 8, 8],
        [96, 56, 8, 8],
        [48, 72, 8, 8],
        [72, 72, 8, 8],
        [56, 80, 16, 8],
      ],
      INK,
    ],
    [BLUSH_RECTS, BLUSH],
  ],
  thinking: [
    [
      [
        [40, 40, 8, 16],
        [96, 40, 8, 16],
        [72, 72, 8, 8],
      ],
      INK,
    ],
    [BLUSH_RECTS, BLUSH],
  ],
  sad: [
    [
      [
        [32, 56, 8, 8],
        [88, 56, 8, 8],
        [56, 76, 16, 8],
        [48, 84, 8, 8],
        [72, 84, 8, 8],
      ],
      INK,
    ],
    [[[32, 64, 8, 8]], TEAR],
    [BLUSH_RECTS.map(([x, y, w, h]) => [x, y + 8, w, h] as R), BLUSH],
  ],
};

const scanningFace = (gaze: 'left' | 'right'): [R[], string][] => [
  [
    gaze === 'right'
      ? [
          [40, 48, 8, 16],
          [96, 48, 8, 16],
          [56, 72, 16, 8],
        ]
      : [
          [24, 48, 8, 16],
          [80, 48, 8, 16],
          [56, 72, 16, 8],
        ],
    INK,
  ],
];

const draw = (list: readonly R[], fill: string, key: string) =>
  list.map(([x, y, w, h]) => (
    <rect key={`${key}${x}-${y}`} x={x} y={y} width={w} height={h} fill={fill} />
  ));

export function Critter({
  size,
  mood = 'idle',
  gaze = 'right',
  style,
  shadow = true,
}: {
  size: number;
  mood?: Mood;
  gaze?: 'left' | 'right';
  style?: CSSProperties;
  shadow?: boolean;
}) {
  const face = mood === 'scanning' ? scanningFace(gaze) : FACES[mood];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: 'block', overflow: 'visible', ...style }}
    >
      {shadow && <rect x={28} y={106} width={72} height={8} fill="rgba(27,27,47,0.18)" />}
      {draw(BODY_RECTS, BODY, 'b')}
      {TUFT.map(([x, fill]) => (
        <rect key={`t${x}`} x={x} y={8} width={8} height={8} fill={fill} />
      ))}
      <rect x={24} y={16} width={16} height={8} fill={SHINE} />
      {face.map(([rects, fill], i) => draw(rects, fill, `f${i}-`))}
    </svg>
  );
}
