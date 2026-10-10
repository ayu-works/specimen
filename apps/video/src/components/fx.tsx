import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { hash } from '../anim';
import { C, TUFT } from '../theme';

export const Fill = ({ children, style }: { children?: ReactNode; style?: CSSProperties }) => (
  <AbsoluteFill style={style}>{children}</AbsoluteFill>
);

/** Rotating sunburst stripes in the brand colours, like a 90s pop-art backdrop. */
export function Sunburst({
  t,
  colors = [C.purple, C.yellow, C.green, C.red, C.blue],
  base = C.paper,
  rays = 28,
  speed = 6,
  cx = '50%',
  cy = '50%',
  opacity = 1,
  clear = 18,
}: {
  t: number;
  colors?: readonly string[];
  base?: string;
  rays?: number;
  speed?: number;
  cx?: string;
  cy?: string;
  opacity?: number;
  clear?: number;
}) {
  const step = 360 / rays;
  const stops: string[] = [];
  for (let i = 0; i < rays; i++) {
    const a = i * step;
    const col = i % 2 === 0 ? (colors[(i / 2) % colors.length] as string) : 'transparent';
    stops.push(`${col} ${a}deg ${a + step}deg`);
  }
  return (
    <Fill style={{ background: base }}>
      <Fill
        style={{
          opacity,
          background: `conic-gradient(from ${t * speed}deg at ${cx} ${cy}, ${stops.join(',')})`,
          maskImage: `radial-gradient(circle at ${cx} ${cy}, transparent ${clear}%, black ${clear + 22}%)`,
        }}
      />
    </Fill>
  );
}

/** Halftone dots, denser toward the edges. */
export function Halftone({
  color = C.ink,
  opacity = 0.14,
  size = 16,
  dot = 3.2,
  inner = 35,
}: {
  color?: string;
  opacity?: number;
  size?: number;
  dot?: number;
  inner?: number;
}) {
  return (
    <Fill
      style={{
        opacity,
        backgroundImage: `radial-gradient(circle, ${color} ${dot}px, transparent ${dot + 0.6}px)`,
        backgroundSize: `${size}px ${size}px`,
        maskImage: `radial-gradient(ellipse at center, transparent ${inner}%, black 100%)`,
      }}
    />
  );
}

/** Paper grain that "boils" every other frame. */
export function Grain({ opacity = 0.09 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 6;
  return (
    <Fill style={{ opacity, mixBlendMode: 'multiply', pointerEvents: 'none' }}>
      <svg width="100%" height="100%" aria-hidden="true">
        <filter id={`grain${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain${seed})`} />
      </svg>
    </Fill>
  );
}

/** Faint pixel grid, as on the store images. */
export const PixelGrid = ({ color = 'rgba(124,108,245,.10)', size = 32 }) => (
  <Fill
    style={{
      backgroundImage: `linear-gradient(${color} 1px,transparent 1px),linear-gradient(90deg,${color} 1px,transparent 1px)`,
      backgroundSize: `${size}px ${size}px`,
    }}
  />
);

/** Square confetti bursting from a point, with gravity. Rotations snap to 90°. */
export function Confetti({
  t,
  start,
  x,
  y,
  count = 36,
  seed = 1,
  spread = 900,
  size = 18,
  colors = [...TUFT, C.purple],
}: {
  t: number;
  start: number;
  x: number;
  y: number;
  count?: number;
  seed?: number;
  spread?: number;
  size?: number;
  colors?: readonly string[];
}) {
  const e = t - start;
  if (e < 0 || e > 2.2) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const a = hash(seed * 31 + i) * Math.PI * 2;
        const v = spread * (0.45 + 0.55 * hash(seed * 17 + i * 3));
        const px = x + Math.cos(a) * v * e * (1 - e * 0.25);
        const py = y + Math.sin(a) * v * e * (1 - e * 0.25) + 900 * e * e;
        const s = size * (0.5 + hash(i + seed) * 0.8);
        const rot = Math.floor(e * 10 + hash(i) * 4) * 90;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: px - s / 2,
              top: py - s / 2,
              width: s,
              height: s * (hash(i * 7) > 0.5 ? 1 : 0.5),
              background: colors[i % colors.length],
              transform: `rotate(${rot}deg)`,
              opacity: e > 1.6 ? Math.max(0, 1 - (e - 1.6) / 0.6) : 1,
            }}
          />
        );
      })}
    </>
  );
}

/** Four-point pixel sparkle that twinkles. */
export function Sparkle({
  x,
  y,
  size = 40,
  color = C.yellow,
  t,
  phase = 0,
}: {
  x: number;
  y: number;
  size?: number;
  color?: string;
  t: number;
  phase?: number;
}) {
  const k = 0.6 + 0.4 * Math.abs(Math.sin(t * 5 + phase));
  const s = size * k;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 7 7"
      width={s}
      height={s}
      shapeRendering="crispEdges"
      style={{ position: 'absolute', left: x - s / 2, top: y - s / 2 }}
    >
      <rect x={3} y={0} width={1} height={7} fill={color} />
      <rect x={0} y={3} width={7} height={1} fill={color} />
      <rect x={2} y={2} width={3} height={3} fill={color} />
    </svg>
  );
}

/** Scattered floating pixels in the background (store-image motif). */
export function FloatingPixels({
  t,
  W,
  H,
  n = 18,
  seed = 3,
}: {
  t: number;
  W: number;
  H: number;
  n?: number;
  seed?: number;
}) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const s = hash(seed + i) > 0.5 ? 16 : 12;
        const x = hash(seed * 9 + i) * W;
        const y = (hash(seed * 5 + i * 2) * H - t * 30 * (0.5 + hash(i))) % H;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y < 0 ? y + H : y,
              width: s,
              height: s,
              background: [...TUFT, C.purple][i % 5],
              opacity: 0.55,
            }}
          />
        );
      })}
    </>
  );
}
