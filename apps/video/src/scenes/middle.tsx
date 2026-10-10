import type { CSSProperties } from 'react';
import { easeInOut, easeOut, hash, pick, pop, prog } from '../anim';
import { Critter, type Mood } from '../components/Critter';
import {
  Confetti,
  Fill,
  FloatingPixels,
  Halftone,
  PixelGrid,
  Sparkle,
  Sunburst,
} from '../components/fx';
import { Burst, Karaoke, Pill, SlamText } from '../components/type';
import { FileIcon, Keycap, PromptCard, SidePanel, Win, Wordmark } from '../components/ui';
import { C, FONT, SITE } from '../theme';
import { at, LYRICS } from '../timeline';
import type { SceneProps } from './open';

const captionBottom = (L: SceneProps['L']) => pick(L, 56, 56, 260);

/** 10–12 s: the side panel fills with measured swatches. */
export function Measured({ t, lt, L }: SceneProps) {
  const pw = pick(L, 620, 560, 700);
  const ph = pw * 1.02;
  const enter = easeOut(prog(lt, 0, 0.3));
  const px = pick(L, L.W * 0.66 - pw / 2, L.W / 2 - pw / 2, L.W / 2 - pw / 2);
  const py = pick(L, L.H / 2 - ph / 2 - 50, L.H / 2 - ph / 2 - 60, L.H / 2 - ph / 2 - 40);
  return (
    <Fill style={{ background: C.night }}>
      <PixelGrid />
      <FloatingPixels t={t} W={L.W} H={L.H} seed={5} />
      <div
        style={{
          position: 'absolute',
          left: px + (1 - enter) * 600,
          top: py,
          transform: `rotate(${2 - 2 * enter}deg)`,
        }}
      >
        <SidePanel w={pw} h={ph} t={t} start={at(4) + 0.15} />
      </div>
      {L.wide && (
        <div style={{ position: 'absolute', left: 110, top: 300 }}>
          <SlamText
            text="EVERY"
            t={t}
            start={at(4, 0)}
            size={120}
            color={C.white}
            depthColor={C.purple}
          />
          <SlamText
            text="VALUE,"
            t={t}
            start={at(4, 1)}
            size={120}
            color={C.white}
            depthColor={C.purple}
          />
          <SlamText
            text="MEASURED."
            t={t}
            start={at(4, 2)}
            size={120}
            color={C.yellow}
            depthColor={C.purple}
          />
        </div>
      )}
      {L.tall && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 170,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <SlamText
            text="MEASURED."
            t={t}
            start={at(4, 2)}
            size={130}
            color={C.yellow}
            depthColor={C.purple}
          />
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: captionBottom(L),
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Karaoke words={LYRICS.measured} t={t} size={pick(L, 46, 40, 44)} />
      </div>
    </Fill>
  );
}

const ROLES: [string, string, string][] = [
  ['BACKGROUND', SITE.background, C.purple],
  ['TEXT', SITE.text, C.yellow],
  ['ACCENT', SITE.accent, C.green],
  ['LINK', SITE.link, C.pink],
];

/** 12–14 s: one role per beat; the backdrop flips colour with it. */
export function Roles({ t, lt, L }: SceneProps) {
  const i = Math.min(3, Math.floor(lt / 0.5));
  const [role, hex, bg] = ROLES[i] as [string, string, string];
  const st = at(5, i);
  const k = pop(t, st, 0.2);
  const tile = pick(L, 420, 380, 460);
  return (
    <Fill style={{ background: bg }}>
      <Halftone opacity={0.22} size={18} dot={4} inner={15} />
      {[0, 1, 2, 3].map((j) => (
        <Sparkle
          key={j}
          t={t}
          phase={j}
          x={L.W * (0.15 + 0.7 * hash(j + 2))}
          y={L.H * (0.12 + 0.6 * hash(j + 7))}
          size={46}
          color={C.white}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: pick(L, L.W * 0.66, L.W / 2, L.W / 2) - tile / 2,
          top: L.H / 2 - tile / 2 - pick(L, 80, 90, 120),
          transform: `scale(${k}) rotate(${i % 2 ? 3 : -3}deg)`,
        }}
      >
        <div
          style={{
            width: tile,
            height: tile,
            background: hex,
            border: `10px solid ${C.ink}`,
            borderRadius: 34,
            boxShadow: `16px 16px 0 ${C.ink}`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -46,
            transform: 'translateX(-50%) rotate(-4deg)',
          }}
        >
          <Pill
            style={{
              fontFamily: FONT.display,
              fontWeight: 700,
              fontSize: 46,
              whiteSpace: 'nowrap',
              background: C.yellow,
            }}
          >
            {role}
            <span style={{ fontFamily: FONT.mono, fontSize: 32, fontWeight: 700 }}>{hex}</span>
          </Pill>
        </div>
      </div>
      {L.wide && (
        <div
          style={{
            position: 'absolute',
            left: 120,
            top: 300,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <SlamText text="ROLES," t={t} start={at(5, 0)} size={120} color={C.white} />
          <SlamText text="NOT JUST" t={t} start={at(5, 1)} size={120} color={C.white} />
          <SlamText text="HEX." t={t} start={at(5, 2)} size={120} color={C.yellow} />
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: captionBottom(L),
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Karaoke words={LYRICS.roles} t={t} size={pick(L, 46, 40, 44)} />
      </div>
    </Fill>
  );
}

/** 14–16 s: Cmd+C, the prompt types itself, DESIGN.md drops in. */
export function Prompt({ t, lt, L }: SceneProps) {
  const cw = pick(L, 760, 700, 820);
  const ch = pick(L, 800, 780, 900);
  const cx = pick(L, L.W / 2 - cw / 2 - 60, L.W / 2 - cw / 2 - 40, L.W / 2 - cw / 2);
  const cy = pick(L, L.H / 2 - ch / 2 + 50, L.H / 2 - ch / 2 + 70, L.H / 2 - ch / 2 + 100);
  const enter = easeOut(prog(lt, 0, 0.25));
  const fileK = pop(t, at(6, 3), 0.3);
  const keyH = 120;
  return (
    <Fill>
      <Sunburst
        t={t}
        colors={[C.yellow, C.white]}
        base={C.paper}
        rays={30}
        speed={8}
        opacity={0.9}
      />
      <Halftone opacity={0.15} />
      <div
        style={{
          position: 'absolute',
          left: cx,
          top: cy + (1 - enter) * 500,
          transform: `rotate(${-1.5 * enter}deg)`,
        }}
      >
        <PromptCard w={cw} h={ch} t={t} start={at(6, 0.6)} cps={300} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: pick(L, 120, 30, 80),
          top: pick(L, 90, 40, 200),
          display: 'flex',
          gap: 22,
          transform: 'rotate(-6deg)',
        }}
      >
        {(['⌘', 'C'] as const).map((k, i) => {
          const kt = at(6, i * 0.5);
          return (
            <div key={k} style={{ transform: `scale(${pop(t, kt, 0.18)})` }}>
              <Keycap
                label={k}
                w={keyH}
                h={keyH}
                pressed={prog(t, kt + 0.06, 0.05) * (1 - prog(t, kt + 0.2, 0.1))}
              />
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', right: pick(L, 90, 40, 90), top: pick(L, 150, 60, 230) }}>
        <Burst
          label="PROMPT!"
          size={pick(L, 440, 360, 420)}
          fill={C.purple}
          t={t}
          start={at(6, 0.5)}
          rot={8}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          right: pick(L, 230, 60, 120),
          bottom: pick(L, 150, 120, 330),
          transform: `scale(${fileK}) rotate(8deg)`,
        }}
      >
        <FileIcon size={pick(L, 190, 170, 210)} />
      </div>
      <Confetti
        t={t}
        start={at(6, 3)}
        x={pick(L, L.W - 330, L.W - 160, L.W - 230)}
        y={L.H * 0.65}
        count={22}
        seed={12}
      />
    </Fill>
  );
}

const AGENTS = ['Claude Code', 'Cursor', 'v0', 'Lovable'];

/** 16–18 s: breakdown. The prompt goes into any AI agent. */
export function Handoff({ t, lt, L }: SceneProps) {
  const ww = pick(L, 1040, 880, 920);
  const wh = pick(L, 540, 480, 560);
  const wx = L.W / 2 - ww / 2;
  const wy = pick(L, L.H / 2 - wh / 2 - 90, L.H / 2 - wh / 2 - 100, L.H / 2 - wh / 2 - 140);
  const fly = easeInOut(prog(lt, 0.05, 0.6));
  const typed = Math.max(0, Math.floor((lt - 0.65) * 60));
  const reply = 'Building a new page with this system…';
  return (
    <Fill style={{ background: '#2a2350' }}>
      <PixelGrid color="rgba(169,155,255,.12)" size={36} />
      <Halftone color={C.shine} opacity={0.15} />
      <Win title="your-agent" w={ww} h={wh} bar={C.yellow} style={{ left: wx, top: wy }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 30, color: C.ink, lineHeight: 1.5 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: fly > 0.95 ? 1 : 0 }}
          >
            <span style={{ color: C.purple, fontWeight: 700 }}>&gt;</span>
            <span
              style={{
                background: C.paperDark,
                border: `3px solid ${C.ink}`,
                borderRadius: 10,
                padding: '4px 14px',
                fontSize: 26,
              }}
            >
              specimen-prompt.md · 1.4k tokens
            </span>
          </div>
          <div style={{ marginTop: 26, color: '#4a4766' }}>{reply.slice(0, typed)}</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 30, flexWrap: 'wrap' }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  height: 60,
                  flex: 1,
                  borderRadius: 12,
                  background: [SITE.accent, SITE.text, SITE.link][i],
                  border: `4px solid ${C.ink}`,
                  transform: `scaleX(${easeOut(prog(lt, 1.1 + i * 0.12, 0.3))})`,
                  transformOrigin: 'left',
                }}
              />
            ))}
          </div>
        </div>
      </Win>
      {/* The prompt card flying in */}
      <div
        style={{
          position: 'absolute',
          left: wx + ww * 0.1 + (1 - fly) * -500,
          top: wy + 70 + (1 - fly) * 400,
          transform: `scale(${1 - 0.7 * fly}) rotate(${(1 - fly) * -20}deg)`,
          transformOrigin: 'top left',
          opacity: fly < 0.97 ? 1 : 0,
        }}
      >
        <PromptCard w={420} h={300} t={99} start={0} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: wy + wh + 50,
          display: 'flex',
          justifyContent: 'center',
          gap: 18,
          flexWrap: 'wrap',
          padding: '0 40px',
        }}
      >
        {AGENTS.map((a, i) => (
          <div
            key={a}
            style={{
              transform: `scale(${pop(t, at(7, i * 0.5), 0.2)}) rotate(${i % 2 ? 2 : -2}deg)`,
            }}
          >
            <Pill
              bg={[C.white, C.green, C.pink, C.shine][i]}
              style={{
                fontFamily: FONT.body,
                fontWeight: 800,
                fontSize: pick(L, 34, 30, 34),
                padding: '6px 22px',
              }}
            >
              {a}
            </Pill>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: pick(L, 90, 40, 60), top: wy - 120 }}>
        <Critter size={160} mood="thinking" />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: captionBottom(L),
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Karaoke words={LYRICS.handoff} t={t} size={pick(L, 46, 40, 44)} />
      </div>
    </Fill>
  );
}

/** 18–20 s: chorus. A new page assembles from the measured tokens. */
export function Build({ t, lt, L }: SceneProps) {
  const pw = pick(L, 760, 700, 860);
  const ph = pw * 0.62;
  const px = L.W / 2 - pw / 2;
  const py = L.H / 2 - ph / 2 + pick(L, 30, 20, 0);
  const u = pw / 100;
  const block = (i: number, style: CSSProperties) => {
    const bt = 0.1 + i * 0.12;
    const p = easeOut(prog(lt, bt, 0.2));
    const dir = hash(i * 4) > 0.5 ? 1 : -1;
    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          transform: `translate(${(1 - p) * dir * 300}px, ${(1 - p) * -200}px) rotate(${(1 - p) * dir * 25}deg)`,
          opacity: p > 0 ? 1 : 0,
          ...style,
        }}
      />
    );
  };
  return (
    <Fill>
      <Sunburst t={t} speed={30} rays={36} />
      <Halftone opacity={0.2} inner={20} />
      <div
        style={{
          position: 'absolute',
          left: px,
          top: py,
          width: pw,
          height: ph,
          background: SITE.background,
          border: `8px solid ${C.ink}`,
          borderRadius: 26,
          boxShadow: `16px 16px 0 ${C.ink}`,
          overflow: 'hidden',
          transform: `rotate(${-1 + Math.sin(t * 8) * 0.6}deg)`,
        }}
      >
        {block(0, {
          left: 5 * u,
          top: 5 * u,
          width: 30 * u,
          height: 4 * u,
          background: SITE.text,
          borderRadius: u,
        })}
        {block(1, {
          right: 5 * u,
          top: 4.4 * u,
          width: 14 * u,
          height: 5 * u,
          background: SITE.accent,
          borderRadius: 999,
        })}
        {block(2, {
          left: 5 * u,
          top: 15 * u,
          width: 55 * u,
          height: 7 * u,
          background: SITE.text,
          borderRadius: u,
        })}
        {block(3, {
          left: 5 * u,
          top: 24 * u,
          width: 40 * u,
          height: 7 * u,
          background: SITE.text,
          borderRadius: u,
        })}
        {block(4, {
          left: 5 * u,
          top: 35 * u,
          width: 18 * u,
          height: 6 * u,
          background: SITE.accent,
          borderRadius: 999,
        })}
        {block(5, {
          right: 5 * u,
          top: 15 * u,
          width: 30 * u,
          height: 22 * u,
          background: SITE.link,
          borderRadius: 2 * u,
          boxShadow: '0 20px 40px rgba(0,0,0,.2)',
        })}
        {[0, 1, 2].map((j) =>
          block(6 + j, {
            left: (5 + j * 31) * u,
            top: 45 * u,
            width: 28 * u,
            height: 14 * u,
            background: SITE.surface,
            border: `${0.4 * u}px solid ${SITE.border}`,
            borderRadius: 2 * u,
            boxShadow: '0 10px 24px rgba(31,27,22,.12)',
          }),
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: pick(L, 30, 120, 200),
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <SlamText
          text="SCAN IT."
          t={t}
          start={at(8, 0)}
          size={pick(L, 150, 130, 160)}
          color={C.yellow}
          depthColor={C.purple}
          tilt={-3}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: pick(L, 30, 40, 230),
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <SlamText
          text="BUILD YOURS."
          t={t}
          start={at(8, 2)}
          size={pick(L, 150, 110, 120)}
          color={C.white}
          depthColor={C.red}
          tilt={-3}
        />
      </div>
      <Confetti
        t={t}
        start={at(8, 0)}
        x={L.W / 2}
        y={L.H * 0.2}
        count={40}
        spread={1400}
        size={24}
        seed={21}
      />
      <Confetti
        t={t}
        start={at(8, 2)}
        x={L.W / 2}
        y={L.H * 0.8}
        count={40}
        spread={1400}
        size={24}
        seed={22}
      />
    </Fill>
  );
}

const CREW: Mood[] = ['scanning', 'idle', 'happy', 'thinking', 'happy'];

/** 20–22 s: the critter crew on stage, wordmark in lights. */
export function Stage({ t, lt, L }: SceneProps) {
  const n = L.tall ? 3 : 5;
  const size = pick(L, 230, 176, 250);
  const gap = pick(L, 70, 24, 40);
  const rowW = n * size + (n - 1) * gap;
  const floorY = pick(L, L.H * 0.78, L.H * 0.8, L.H * 0.7);
  const beatPhase = ((t - at(9)) / 0.5) % 1;
  return (
    <Fill style={{ background: '#16112e' }}>
      {[0, 1, 2, 3].map((i) => {
        const a = Math.sin(t * 2.2 + i * 1.3) * 22 + (i - 1.5) * 18;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: L.W * (0.15 + i * 0.23) - 160,
              top: -40,
              width: 320,
              height: L.H * 1.1,
              background: `linear-gradient(180deg, ${[C.purple, C.yellow, C.green, C.red][i]}aa, transparent 80%)`,
              clipPath: 'polygon(42% 0, 58% 0, 100% 100%, 0 100%)',
              transform: `rotate(${a}deg)`,
              transformOrigin: 'top center',
              mixBlendMode: 'screen',
              opacity: 0.55,
            }}
          />
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: floorY,
          bottom: 0,
          background: `repeating-linear-gradient(90deg, ${C.purple} 0 60px, #5b4fd0 60px 120px)`,
          borderTop: `10px solid ${C.ink}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: pick(L, 90, 90, 330),
          display: 'flex',
          justifyContent: 'center',
          transform: `scale(${pop(lt, 0, 0.3)})`,
        }}
      >
        <div
          style={{
            padding: '30px 50px',
            background: '#0b0820',
            border: `8px solid ${C.yellow}`,
            borderRadius: 30,
            boxShadow: `0 0 60px ${C.purple}, 12px 12px 0 ${C.ink}`,
          }}
        >
          <Wordmark
            height={pick(L, 120, 92, 92)}
            color={C.white}
            reveal={easeOut(prog(lt, 0, 0.5))}
            shadow={C.purple}
          />
        </div>
      </div>
      {Array.from({ length: n }, (_, i) => {
        const mood = (L.tall ? (['scanning', 'happy', 'thinking'] as Mood[])[i] : CREW[i]) as Mood;
        const big = i === Math.floor(n / 2);
        const s = big ? size * 1.25 : size;
        const hop =
          Math.sin(Math.min(1, beatPhase * 2) * Math.PI) *
          (big ? 46 : 30) *
          (i % 2 === Math.floor(lt * 2) % 2 ? 1 : 0.4);
        const x = L.W / 2 - rowW / 2 + i * (size + gap) - (s - size) / 2;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: floorY - s * 0.86 - hop,
              transform: `scale(${pop(lt, i * 0.06, 0.25)})`,
            }}
          >
            <Critter size={s} mood={mood} gaze={Math.floor(t * 4) % 2 ? 'left' : 'right'} />
          </div>
        );
      })}
      {Array.from({ length: 22 }, (_, i) => {
        const x = (i / 21) * L.W;
        const h = 60 + hash(i) * 50 + Math.max(0, Math.sin(t * 9 + i)) * 30;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - 30,
              bottom: -20,
              width: 60,
              height: h,
              background: '#0b0820',
              borderRadius: '30px 30px 0 0',
            }}
          />
        );
      })}
      <Sparkle t={t} x={L.W * 0.1} y={L.H * 0.4} size={60} />
      <Sparkle t={t} phase={2} x={L.W * 0.9} y={L.H * 0.35} size={60} color={C.green} />
    </Fill>
  );
}
