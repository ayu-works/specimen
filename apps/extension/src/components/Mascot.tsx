import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export type MascotMood = 'idle' | 'scanning' | 'happy' | 'thinking' | 'sad';

/** Rect on the 16x16 art grid: x, y, w, h in 8-unit pixels of the 128 viewBox. */
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

const TUFT: [number, number, number, number, string][] = [
  [48, 8, 8, 8, '#FF6B6B'],
  [56, 8, 8, 8, '#FFD166'],
  [64, 8, 8, 8, '#06D6A0'],
  [72, 8, 8, 8, '#4D96FF'],
];

const BLUSH_RECTS: R[] = [
  [24, 64, 8, 8],
  [96, 64, 8, 8],
];

const rects = (list: R[], fill: string, key: string, className?: string) =>
  list.map(([x, y, w, h]) => (
    <rect
      key={`${key}${x}-${y}`}
      x={x}
      y={y}
      width={w}
      height={h}
      fill={fill}
      className={className}
    />
  ));

/** Face only: the body, tuft and highlight never change between moods. */
function Face({ mood }: { mood: MascotMood }) {
  switch (mood) {
    case 'scanning':
      return (
        <>
          {/* Looks right by default; with motion allowed the gaze alternates left and right. */}
          <g className="mascot-gaze-right">
            {rects(
              [
                [40, 48, 8, 16],
                [96, 48, 8, 16],
              ],
              INK,
              'er',
            )}
          </g>
          <g className="mascot-gaze-left">
            {rects(
              [
                [24, 48, 8, 16],
                [80, 48, 8, 16],
              ],
              INK,
              'el',
            )}
          </g>
          {rects([[56, 72, 16, 8]], INK, 'm')}
        </>
      );
    case 'happy':
      return (
        <>
          {rects(
            [
              [32, 48, 8, 8],
              [24, 56, 8, 8],
              [40, 56, 8, 8],
              [88, 48, 8, 8],
              [80, 56, 8, 8],
              [96, 56, 8, 8],
            ],
            INK,
            'e',
          )}
          {rects(BLUSH_RECTS, BLUSH, 'b')}
          {rects(
            [
              [48, 72, 8, 8],
              [72, 72, 8, 8],
              [56, 80, 16, 8],
            ],
            INK,
            'm',
          )}
        </>
      );
    case 'thinking':
      return (
        <>
          {rects(
            [
              [40, 40, 8, 16],
              [96, 40, 8, 16],
            ],
            INK,
            'e',
          )}
          {rects(BLUSH_RECTS, BLUSH, 'b')}
          {rects([[72, 72, 8, 8]], INK, 'm')}
        </>
      );
    case 'sad':
      return (
        <>
          {rects(
            [
              [32, 56, 8, 8],
              [88, 56, 8, 8],
            ],
            INK,
            'e',
          )}
          {rects([[32, 64, 8, 8]], TEAR, 't')}
          {rects(
            BLUSH_RECTS.map(([x, y, w, h]) => [x, y + 8, w, h] as R),
            BLUSH,
            'b',
          )}
          {rects(
            [
              [56, 76, 16, 8],
              [48, 84, 8, 8],
              [72, 84, 8, 8],
            ],
            INK,
            'm',
          )}
        </>
      );
    default:
      return (
        <>
          {rects(
            [
              [32, 48, 8, 16],
              [88, 48, 8, 16],
            ],
            INK,
            'e',
          )}
          {rects(BLUSH_RECTS, BLUSH, 'b')}
          {rects([[56, 68, 16, 8]], INK, 'm')}
        </>
      );
  }
}

type MascotProps = {
  /** Multiples of 16 keep every art pixel a whole screen pixel: 16, 32, 48, 64, 96. */
  size?: 16 | 32 | 48 | 64 | 96;
  mood?: MascotMood;
  /** Gentle one-art-pixel hop in steps(). Off under prefers-reduced-motion. */
  bounce?: boolean;
  className?: string;
};

/** Specimen's critter. Decorative: the surrounding text carries the meaning. */
export function Mascot({ size = 32, mood = 'idle', bounce = false, className }: MascotProps) {
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
      data-testid="mascot"
      data-mood={mood}
      style={{ '--mascot-hop': `${size / 16}px` } as CSSProperties}
      className={cn(
        'mascot shrink-0',
        bounce && 'mascot-bounce',
        mood === 'scanning' && 'mascot-scanning',
        className,
      )}
    >
      <g shapeRendering="crispEdges">
        {rects(BODY_RECTS, BODY, 'body')}
        {TUFT.map(([x, y, w, h, fill]) => (
          <rect key={fill} x={x} y={y} width={w} height={h} fill={fill} />
        ))}
        <rect x={24} y={16} width={16} height={8} fill={SHINE} />
        <Face mood={mood} />
      </g>
    </svg>
  );
}
