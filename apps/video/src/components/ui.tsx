import type { CSSProperties, ReactNode } from 'react';
import { easeOut, prog } from '../anim';
import { C, FONT, SITE } from '../theme';
import { Critter } from './Critter';
import { WORDMARK_CELLS, WORDMARK_COLS, WORDMARK_ROWS } from './wordmark-data';

/** The pixel "Specimen" wordmark. `reveal` 0→1 draws cells left to right. */
export function Wordmark({
  height,
  color = C.ink,
  reveal = 1,
  shadow,
}: {
  height: number;
  color?: string;
  reveal?: number;
  shadow?: string;
}) {
  const cell = height / WORDMARK_ROWS;
  const cols = Math.ceil(reveal * WORDMARK_COLS);
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${WORDMARK_COLS} ${WORDMARK_ROWS}`}
      width={cell * WORDMARK_COLS}
      height={height}
      shapeRendering="crispEdges"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {shadow &&
        WORDMARK_CELLS.filter(([x]) => x < cols).map(([x, y]) => (
          <rect key={`s${x}-${y}`} x={x + 0.35} y={y + 0.35} width={1} height={1} fill={shadow} />
        ))}
      {WORDMARK_CELLS.filter(([x]) => x < cols).map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />
      ))}
    </svg>
  );
}

/** A chunky keyboard key. Pressed state sinks into its base. */
export function Keycap({
  label,
  w = 200,
  h = 180,
  pressed = 0,
  fontSize,
  accent = C.purple,
}: {
  label: string;
  w?: number;
  h?: number;
  pressed?: number;
  fontSize?: number;
  accent?: string;
}) {
  const depth = 22 * (1 - pressed * 0.75);
  return (
    <div style={{ position: 'relative', width: w, height: h + 22 }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 22,
          width: w,
          height: h,
          borderRadius: 34,
          background: '#CFC7B8',
          border: `6px solid ${C.ink}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 22 - depth,
          width: w,
          height: h,
          borderRadius: 34,
          background: C.white,
          border: `6px solid ${C.ink}`,
          display: 'grid',
          placeItems: 'center',
          boxShadow: 'inset 0 -14px 0 #E9E2D6',
          fontFamily: FONT.display,
          fontWeight: 700,
          fontSize: fontSize ?? h * 0.42,
          color: C.ink,
          textShadow: `4px 4px 0 ${accent}`,
        }}
      >
        {label}
      </div>
    </div>
  );
}

const bar = (w: number | string, h: number, bg: string, style?: CSSProperties) => (
  <div
    style={{ width: w, height: h, background: bg, borderRadius: h / 2, flexShrink: 0, ...style }}
  />
);

/**
 * A made-up landing page, drawn with blocks (no real brand, no real copy).
 * `color` 0 = grey dot-matrix "vibe", 1 = the real measured colours.
 */
export function FakeSite({
  w,
  h,
  color = 1,
  highlight,
}: {
  w: number;
  h: number;
  color?: number;
  highlight?: 'colors' | 'type' | 'spacing' | 'radii' | 'shadows';
}) {
  const grey = color < 0.5;
  const S = grey
    ? {
        background: '#D9D6CF',
        surface: '#E4E1DA',
        text: '#8E8A83',
        muted: '#AAA69F',
        accent: '#8E8A83',
        link: '#9C9891',
        border: '#B9B5AE',
      }
    : SITE;
  const u = w / 100;
  const radius = grey ? 2 : u * 1.6;
  const card = (i: number) => (
    <div
      key={i}
      style={{
        flex: 1,
        background: S.surface,
        border: `${Math.max(2, u * 0.25)}px ${grey ? 'dashed' : 'solid'} ${S.border}`,
        borderRadius: radius,
        padding: u * 2.4,
        display: 'flex',
        flexDirection: 'column',
        gap: u * 1.2,
        boxShadow: grey ? 'none' : `0 ${u * 1.2}px ${u * 3}px rgba(31,27,22,.10)`,
        outline: highlight === 'shadows' ? `${u * 0.5}px solid ${C.purple}` : undefined,
      }}
    >
      <div
        style={{
          width: u * 6,
          height: u * 6,
          borderRadius: highlight === 'radii' ? u * 3 : radius,
          background: i === 1 ? S.accent : S.link,
          opacity: grey ? 0.6 : 0.9,
        }}
      />
      {bar('70%', u * 1.6, S.text)}
      {bar('90%', u * 1, S.muted)}
      {bar('60%', u * 1, S.muted)}
    </div>
  );
  return (
    <div
      style={{
        width: w,
        height: h,
        background: S.background,
        border: `${Math.max(4, u * 0.6)}px solid ${C.ink}`,
        borderRadius: u * 1.8,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: `${u * 1.4}px ${u * 1.4}px 0 ${C.ink}`,
        position: 'relative',
      }}
    >
      {/* browser chrome */}
      <div
        style={{
          height: u * 4.4,
          background: grey ? '#CBC7C0' : '#EFE8DD',
          display: 'flex',
          alignItems: 'center',
          gap: u * 1,
          padding: `0 ${u * 2}px`,
          borderBottom: `${Math.max(3, u * 0.4)}px solid ${C.ink}`,
        }}
      >
        {[C.red, C.yellow, C.green].map((c) => (
          <div
            key={c}
            style={{
              width: u * 1.5,
              height: u * 1.5,
              borderRadius: '50%',
              background: grey ? '#A9A59E' : c,
              border: `2px solid ${C.ink}`,
            }}
          />
        ))}
        {bar(u * 40, u * 1.8, grey ? '#E0DDD6' : C.white, {
          marginLeft: u * 3,
          border: `2px solid ${grey ? '#A9A59E' : SITE.border}`,
        })}
      </div>
      {/* nav */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: `${u * 2.4}px ${u * 5}px`,
          gap: u * 3,
        }}
      >
        <div
          style={{ width: u * 3.4, height: u * 3.4, borderRadius: radius, background: S.accent }}
        />
        {bar(u * 10, u * 1.6, S.text)}
        <div style={{ flex: 1 }} />
        {bar(u * 7, u * 1.1, S.muted)}
        {bar(u * 7, u * 1.1, S.muted)}
        {bar(u * 7, u * 1.1, S.muted)}
        <div
          style={{
            width: u * 12,
            height: u * 4,
            borderRadius: highlight === 'radii' ? u * 2 : radius,
            background: S.text,
          }}
        />
      </div>
      {/* hero */}
      <div
        style={{
          padding: `${u * 3}px ${u * 5}px ${u * 2}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: u * 1.6,
          outline: highlight === 'type' ? `${u * 0.5}px solid ${C.purple}` : undefined,
          outlineOffset: -u,
        }}
      >
        {bar('72%', u * 4.6, S.text, { borderRadius: u })}
        {bar('48%', u * 4.6, S.text, { borderRadius: u })}
        {bar('56%', u * 1.4, S.muted, { marginTop: u * 1.2 })}
        <div style={{ display: 'flex', gap: u * 1.6, marginTop: u * 1.6 }}>
          <div
            style={{
              width: u * 16,
              height: u * 5,
              borderRadius: highlight === 'radii' ? u * 2.5 : radius,
              background: S.accent,
            }}
          />
          <div
            style={{
              width: u * 16,
              height: u * 5,
              borderRadius: highlight === 'radii' ? u * 2.5 : radius,
              border: `${Math.max(2, u * 0.3)}px solid ${S.text}`,
            }}
          />
        </div>
      </div>
      {/* cards */}
      <div
        style={{
          display: 'flex',
          gap: highlight === 'spacing' ? u * 3.2 : u * 2.4,
          padding: `${u * 2}px ${u * 5}px`,
          flex: 1,
        }}
      >
        {[0, 1, 2].map(card)}
      </div>
      {grey && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle, rgba(27,27,47,.18) 1.4px, transparent 1.8px)',
            backgroundSize: '9px 9px',
          }}
        />
      )}
    </div>
  );
}

/** A pixel cursor arrow. */
export const Cursor = ({ size = 40, style }: { size?: number; style?: CSSProperties }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 10 14"
    width={size}
    height={size * 1.4}
    shapeRendering="crispEdges"
    style={{ position: 'absolute', ...style }}
  >
    <path
      d="M0 0h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h-4v1h1v2h1v2h-2v-2h-1v-2h-1v1h-1v1h-1z"
      fill={C.ink}
    />
    <path d="M1 2h1v1h1v1h1v1h1v1h1v1h1v1h1v1h-3v1h1v2h1v1h-1v-2h-1v-2h-2v1h-1z" fill={C.white} />
  </svg>
);

/** A small app window with title bar (for the sign-up / upload props). */
export function Win({
  title,
  w,
  h,
  children,
  bar: barColor = C.shine,
  style,
}: {
  title: string;
  w: number;
  h: number;
  children: ReactNode;
  bar?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        width: w,
        height: h,
        background: C.white,
        border: `6px solid ${C.ink}`,
        borderRadius: 14,
        boxShadow: `10px 10px 0 ${C.ink}`,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          height: 48,
          background: barColor,
          borderBottom: `5px solid ${C.ink}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 16px',
          fontFamily: FONT.mono,
          fontWeight: 700,
          fontSize: 22,
          color: C.ink,
        }}
      >
        {[C.red, C.yellow, C.green].map((c) => (
          <div
            key={c}
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: c,
              border: `3px solid ${C.ink}`,
            }}
          />
        ))}
        <div style={{ marginLeft: 'auto' }}>{title}</div>
      </div>
      <div style={{ padding: 26 }}>{children}</div>
    </div>
  );
}

/** Side panel mock-up (dark), drawn after the real extension's Inspect tab. */
export function SidePanel({
  w,
  h,
  t,
  start,
  tab = 'Inspect',
}: {
  w: number;
  h: number;
  t: number;
  start: number;
  tab?: string;
}) {
  const rows: [string, string][] = [
    ['background', SITE.background],
    ['surface', SITE.surface],
    ['textPrimary', SITE.text],
    ['textSecondary', SITE.muted],
    ['accent', SITE.accent],
    ['link', SITE.link],
    ['border', SITE.border],
  ];
  const u = w / 100;
  return (
    <div
      style={{
        width: w,
        height: h,
        background: '#0a0a0c',
        border: `${u * 0.9}px solid ${C.ink}`,
        borderRadius: u * 3.4,
        boxShadow: `${u * 2}px ${u * 2}px 0 ${C.purple}`,
        overflow: 'hidden',
        fontFamily: FONT.body,
        color: '#F4F2FF',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: u * 2.4,
          padding: `${u * 4}px ${u * 5}px ${u * 2}px`,
        }}
      >
        <Critter size={u * 9} mood="happy" shadow={false} />
        <div style={{ fontWeight: 700, fontSize: u * 5 }}>Specimen</div>
        <div
          style={{
            marginLeft: 'auto',
            fontSize: u * 3.2,
            color: '#8b8798',
            border: '1px solid #333',
            borderRadius: 99,
            padding: `${u * 0.6}px ${u * 2}px`,
          }}
        >
          AI off
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: u * 4.5,
          padding: `0 ${u * 5}px`,
          fontSize: u * 3.6,
          color: '#8b8798',
          borderBottom: '1px solid #222',
        }}
      >
        {['Scan', 'Inspect', 'Generate', 'Ask', 'Library'].map((x) => (
          <div
            key={x}
            style={{
              padding: `${u * 2}px 0`,
              color: x === tab ? '#fff' : undefined,
              borderBottom: x === tab ? `${u * 0.6}px solid #fff` : undefined,
            }}
          >
            {x}
          </div>
        ))}
      </div>
      <div
        style={{
          padding: `${u * 4}px ${u * 5}px`,
          fontSize: u * 3,
          letterSpacing: '0.1em',
          color: '#8b8798',
          fontWeight: 700,
        }}
      >
        PALETTE
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: u * 2.2,
          padding: `0 ${u * 5}px`,
        }}
      >
        {rows.map(([role, hex], i) => {
          const p = easeOut(prog(t, start + i * 0.07, 0.25));
          return (
            <div
              key={role}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: u * 2.4,
                border: '1px solid #26262c',
                borderRadius: u * 2,
                padding: u * 2,
                opacity: p,
                transform: `translateY(${(1 - p) * u * 4}px)`,
              }}
            >
              <div
                style={{
                  width: u * 7,
                  height: u * 7,
                  borderRadius: u * 1.4,
                  background: hex,
                  border: '1px solid #444',
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ fontSize: u * 3.2, color: '#C4C1E0' }}>{role}</div>
                <div style={{ fontFamily: FONT.mono, fontSize: u * 3.4 }}>{hex.toLowerCase()}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The generated prompt, typed into a dark card. Generic copy only. */
export const PROMPT_TEXT = `## Goal
Build a new, original page with
the visual system below. Do not
copy any brand, logo or text.

## Colors
background   ${SITE.background}
text         ${SITE.text}
accent       ${SITE.accent}
border       ${SITE.border}

## Type
display  44/1.1  700
body     16/1.5  500

## Spacing  4 · 8 · 12 · 16 · 24 · 32
## Radius   8 · 12 · 999`;

export function PromptCard({
  w,
  h,
  t,
  start,
  cps = 260,
}: {
  w: number;
  h: number;
  t: number;
  start: number;
  cps?: number;
}) {
  const n = Math.max(0, Math.floor((t - start) * cps));
  const text = PROMPT_TEXT.slice(0, n);
  const u = w / 100;
  return (
    <div
      style={{
        width: w,
        height: h,
        background: C.night,
        border: `${u * 0.9}px solid ${C.ink}`,
        borderRadius: u * 3,
        boxShadow: `${u * 2}px ${u * 2}px 0 ${C.yellow}`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: u * 2,
          padding: `${u * 3}px ${u * 4}px`,
          borderBottom: '2px solid #23233a',
        }}
      >
        <div
          style={{
            fontFamily: FONT.display,
            fontSize: u * 3.8,
            color: C.shine,
            letterSpacing: '0.08em',
          }}
        >
          PROMPT
        </div>
        <div
          style={{ marginLeft: 'auto', fontFamily: FONT.mono, fontSize: u * 3, color: '#8b8798' }}
        >
          {Math.min(n, PROMPT_TEXT.length)} chars
        </div>
      </div>
      <pre
        style={{
          margin: 0,
          padding: `${u * 3}px ${u * 4}px`,
          fontFamily: FONT.mono,
          fontWeight: 500,
          fontSize: u * 3.6,
          lineHeight: 1.45,
          color: '#E8E6F5',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text.split('\n').map((ln, i) => (
          <div key={i} style={{ color: ln.startsWith('##') ? C.yellow : undefined }}>
            {ln || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

/** Pixel file icon labelled DESIGN.md. */
export function FileIcon({ size, label = 'DESIGN.md' }: { size: number; label?: string }) {
  return (
    <div style={{ position: 'relative', width: size, height: size * 1.25 }}>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 20"
        width={size}
        height={size * 1.25}
        shapeRendering="crispEdges"
      >
        <path d="M1 0h10v1h1v1h1v1h1v1h1v15h-1v1H1v-1H0V1h1z" fill={C.ink} />
        <path d="M1 1h9v4h4v14H1z" fill={C.white} />
        <path d="M11 1h0v3h3v0h-1v-1h-1v-1h-1z" fill={C.ink} />
        <rect x={3} y={8} width={8} height={1} fill={C.purple} />
        <rect x={3} y={10} width={10} height={1} fill={C.grey} />
        <rect x={3} y={12} width={9} height={1} fill={C.grey} />
        <rect x={3} y={14} width={6} height={1} fill={C.grey} />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: -size * 0.32,
          transform: 'translateX(-50%)',
          background: C.yellow,
          border: `4px solid ${C.ink}`,
          borderRadius: 10,
          padding: '2px 12px',
          fontFamily: FONT.mono,
          fontWeight: 700,
          fontSize: size * 0.16,
          whiteSpace: 'nowrap',
          color: C.ink,
        }}
      >
        {label}
      </div>
    </div>
  );
}
