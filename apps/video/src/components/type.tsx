import type { CSSProperties, ReactNode } from 'react';
import { easeOut, hash, pop, prog, slam, useVariant } from '../anim';
import { C, FONT } from '../theme';
import { TOKEN_KEYS, TOKENS_TOTAL, type Word } from '../timeline';

/** Thick outline plus a hard offset shadow, built from text-shadows. */
export const outline = (
  w: number,
  color: string = C.ink,
  depth = 0,
  depthColor: string = C.ink,
) => {
  const s: string[] = [];
  for (let a = 0; a < 360; a += 22.5) {
    const r = (a * Math.PI) / 180;
    s.push(`${(Math.cos(r) * w).toFixed(1)}px ${(Math.sin(r) * w).toFixed(1)}px 0 ${color}`);
  }
  for (let d = 1; d <= depth; d += 2) s.push(`${d + w * 0.6}px ${d + w * 0.6}px 0 ${depthColor}`);
  return s.join(',');
};

/** Display caps that slam in letter by letter. */
export function SlamText({
  text,
  t,
  start,
  size,
  color = C.yellow,
  stroke = C.ink,
  depth = 12,
  depthColor = C.ink,
  stagger = 0.045,
  style,
  tilt = 0,
}: {
  text: string;
  t: number;
  start: number;
  size: number;
  color?: string;
  stroke?: string;
  depth?: number;
  depthColor?: string;
  stagger?: number;
  style?: CSSProperties;
  tilt?: number;
}) {
  return (
    <div
      style={{
        fontFamily: FONT.display,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 0.95,
        color,
        whiteSpace: 'nowrap',
        textShadow: outline(size * 0.06, stroke, depth, depthColor),
        transform: `rotate(${tilt}deg)`,
        letterSpacing: '-0.02em',
        ...style,
      }}
    >
      {Array.from(text).map((ch, i) => {
        const st = start + i * stagger;
        const k = slam(t, st, 2.2, 0.12);
        const r = (hash(i * 13 + text.length) - 0.5) * 14 * (1 - prog(t, st, 0.3));
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transform: `scale(${k}) rotate(${r}deg)`,
              opacity: t < st ? 0 : 1,
              minWidth: ch === ' ' ? '0.4em' : undefined,
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
}

/** A rounded white pill with a hard ink border and offset shadow. */
export function Pill({
  children,
  style,
  bg = C.white,
}: {
  children: ReactNode;
  style?: CSSProperties;
  bg?: string;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        background: bg,
        border: `5px solid ${C.ink}`,
        borderRadius: 18,
        boxShadow: `7px 7px 0 ${C.ink}`,
        padding: '10px 26px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Karaoke subtitle: the current word sits on a purple chip. */
export function Karaoke({
  words,
  t,
  size = 44,
  style,
}: {
  words: Word[];
  t: number;
  size?: number;
  style?: CSSProperties;
}) {
  if (!useVariant().karaoke) return null;
  const first = words[0]?.t ?? 0;
  const k = pop(t, first - 0.2, 0.25);
  return (
    <div style={{ transform: `scale(${k})`, ...style }}>
      <Pill
        style={{
          fontFamily: FONT.body,
          fontWeight: 800,
          fontSize: size,
          gap: size * 0.28,
          letterSpacing: '-0.01em',
        }}
      >
        {words.map((w, i) => {
          const next = words[i + 1]?.t ?? Number.POSITIVE_INFINITY;
          const active = t >= w.t && t < next;
          const sung = t >= w.t;
          return (
            <span
              key={w.w + w.t}
              style={{
                color: active ? C.white : sung ? C.ink : '#A7A3B5',
                background: active ? C.purple : 'transparent',
                borderRadius: 8,
                padding: '0 8px',
                margin: '0 -8px',
                transform: active ? `translateY(${-4 * (1 - prog(t, w.t, 0.12))}px)` : undefined,
                display: 'inline-block',
              }}
            >
              {w.w}
            </span>
          );
        })}
      </Pill>
    </div>
  );
}

const tokensAt = (t: number) => {
  for (let i = 1; i < TOKEN_KEYS.length; i++) {
    const [t1, v1] = TOKEN_KEYS[i] as [number, number];
    const [t0, v0] = TOKEN_KEYS[i - 1] as [number, number];
    if (t < t1) return Math.round(v0 + (v1 - v0) * easeOut(prog(t, t0, Math.min(0.35, t1 - t0))));
  }
  return TOKENS_TOTAL;
};

/** Top-right counter of measured values, like the reference's STYLES 00/36. */
export function Hud({ t, scale = 1, dark = false }: { t: number; scale?: number; dark?: boolean }) {
  const n = tokensAt(t);
  const blink = Math.floor(t * 2) % 2 === 0;
  return (
    <div
      style={{
        position: 'absolute',
        right: 36 * scale,
        top: 34 * scale,
        transform: `scale(${scale})`,
        transformOrigin: 'top right',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: dark ? C.night : C.white,
        color: dark ? C.white : C.ink,
        border: `4px solid ${dark ? C.shine : C.ink}`,
        borderRadius: 999,
        padding: '8px 22px',
        boxShadow: `5px 5px 0 ${dark ? C.purple : C.ink}`,
        fontFamily: FONT.mono,
        fontWeight: 700,
        fontSize: 26,
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          background: blink ? C.red : C.purple,
          display: 'inline-block',
        }}
      />
      <span style={{ fontFamily: FONT.display, fontSize: 18, letterSpacing: '0.08em' }}>
        TOKENS
      </span>
      <span>
        {String(n).padStart(3, '0')}/{TOKENS_TOTAL}
      </span>
    </div>
  );
}

/** Spiky starburst badge with a label, for feature names. */
export function Burst({
  label,
  size,
  fill,
  color = C.white,
  t,
  start,
  rot = -6,
  fontSize,
}: {
  label: string;
  size: number;
  fill: string;
  color?: string;
  t: number;
  start: number;
  rot?: number;
  fontSize?: number;
}) {
  const k = pop(t, start, 0.28);
  const pts: string[] = [];
  const spikes = 14;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 50 : 38 + hash(i) * 4;
    pts.push(`${50 + Math.cos(a) * r * 1.35},${50 + Math.sin(a) * r * 0.8}`);
  }
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size * 0.62,
        transform: `scale(${k}) rotate(${rot + 3 * Math.sin(t * 6)}deg)`,
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="-20 0 140 100"
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        <polygon points={pts.join(' ')} fill={C.ink} transform="translate(4 5)" />
        <polygon
          points={pts.join(' ')}
          fill={fill}
          stroke={C.ink}
          strokeWidth={3}
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          fontFamily: FONT.display,
          fontWeight: 700,
          fontSize: fontSize ?? Math.min(size * 0.15, (size * 0.8) / Math.max(4, label.length)),
          color,
          letterSpacing: '0.02em',
          textShadow: color === C.ink ? 'none' : outline(2.5, C.ink, 3),
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** Rubber stamp that slams down at `start`. */
export function Stamp({
  text,
  color,
  t,
  start,
  size = 110,
  rot = -12,
  sub,
}: {
  text: string;
  color: string;
  t: number;
  start: number;
  size?: number;
  rot?: number;
  sub?: string;
}) {
  if (t < start) return null;
  const k = slam(t, start, 2.6, 0.1);
  return (
    <div
      style={{
        transform: `rotate(${rot}deg) scale(${k})`,
        border: `${size * 0.09}px solid ${color}`,
        borderRadius: size * 0.16,
        padding: `${size * 0.08}px ${size * 0.22}px`,
        color,
        fontFamily: FONT.display,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 0.95,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        background: 'rgba(255,255,255,0.35)',
        maskImage:
          'repeating-linear-gradient(115deg, black 0 9px, rgba(0,0,0,0.78) 9px 13px), radial-gradient(circle at 30% 40%, black 60%, rgba(0,0,0,.7) 100%)',
        maskComposite: 'intersect',
      }}
    >
      {text}
      {sub && <div style={{ fontSize: size * 0.32, marginTop: size * 0.06 }}>{sub}</div>}
    </div>
  );
}

/** Vertical Japanese side-tab sticker (the reference's katakana labels). */
export function JpTab({
  text,
  t,
  start,
  size = 54,
  bg = C.yellow,
  style,
}: {
  text: string;
  t: number;
  start: number;
  size?: number;
  bg?: string;
  style?: CSSProperties;
}) {
  const p = easeOut(prog(t, start, 0.3));
  const shown = Math.ceil(p * text.length);
  return (
    <div
      style={{
        position: 'absolute',
        writingMode: 'vertical-rl',
        background: bg,
        border: `5px solid ${C.ink}`,
        boxShadow: `6px 6px 0 ${C.ink}`,
        borderRadius: 12,
        padding: '18px 8px',
        fontFamily: FONT.jp,
        fontSize: size,
        color: C.ink,
        letterSpacing: '0.1em',
        opacity: t < start ? 0 : 1,
        ...style,
      }}
    >
      {text.slice(0, Math.max(1, shown))}
    </div>
  );
}

/** Typed caption with a blinking block caret. */
export function Typed({
  text,
  t,
  start,
  step,
  size,
  color,
  style,
}: {
  text: string;
  t: number;
  start: number;
  step: number;
  size: number;
  color: string;
  style?: CSSProperties;
}) {
  const n = Math.max(0, Math.min(text.length, Math.floor((t - start) / step) + 1));
  const caret = t < start + text.length * step || Math.floor(t * 3) % 2 === 0;
  return (
    <div
      style={{
        fontFamily: FONT.body,
        fontWeight: 800,
        fontSize: size,
        color,
        letterSpacing: '-0.03em',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {text.slice(0, t < start ? 0 : n)}
      <span
        style={{
          display: 'inline-block',
          width: size * 0.12,
          height: size * 0.9,
          background: color,
          marginLeft: size * 0.06,
          verticalAlign: '-0.1em',
          opacity: caret ? 1 : 0,
        }}
      />
    </div>
  );
}
