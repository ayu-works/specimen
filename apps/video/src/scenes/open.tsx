import { easeInOut, easeOut, hash, type Layout, pick, pop, prog, slam } from '../anim';
import { Critter } from '../components/Critter';
import { Confetti, Fill, Halftone, Sparkle, Sunburst } from '../components/fx';
import { Burst, JpTab, outline, Pill, SlamText, Typed } from '../components/type';
import { Cursor, FakeSite, Keycap, Wordmark } from '../components/ui';
import { C, FONT, SITE } from '../theme';
import { at, STATIONS, TYPED } from '../timeline';

export type SceneProps = { t: number; lt: number; L: Layout };

/** 0–2 s: the grey "vibe". A site you like, but all you have is a feeling. */
export function Cold({ t, L, typed = TYPED }: SceneProps & { typed?: typeof TYPED }) {
  const sw = pick(L, 1040, 860, 940);
  const sh = sw * 0.64;
  const push = 1 + 0.04 * easeInOut(prog(t - (typed.start - TYPED.start), 0, 2));
  const cx = pick(L, L.W / 2 + 120, L.W / 2, L.W / 2);
  const cy = pick(L, L.H / 2 - 40, L.H / 2 - 90, L.H / 2 - 160);
  const cur = prog(t - (typed.start - TYPED.start), 0.2, 1.1);
  return (
    <Fill style={{ background: '#CFCBC3' }}>
      <Halftone color="#6d6a64" opacity={0.25} size={14} dot={2.2} inner={10} />
      <div
        style={{
          position: 'absolute',
          left: cx - sw / 2,
          top: cy - sh / 2,
          transform: `perspective(1800px) rotateY(-9deg) rotateX(7deg) rotateZ(-2deg) scale(${push})`,
          filter: 'grayscale(1) contrast(0.9)',
        }}
      >
        <FakeSite w={sw} h={sh} color={0} />
        <Cursor
          size={38}
          style={{
            left: sw * (0.62 + 0.12 * easeInOut(cur)),
            top: sh * (0.78 - 0.2 * easeInOut(cur)),
          }}
        />
      </div>
      <Typed
        text={typed.text}
        t={t}
        start={typed.start}
        step={typed.step}
        size={pick(L, 128, 112, 124)}
        color="#7d7972"
        style={{
          position: 'absolute',
          left: pick(L, 90, 60, 70),
          bottom: pick(L, 70, 50, 280),
          whiteSpace: 'pre',
          lineHeight: 1.05,
          textShadow: '6px 6px 0 rgba(27,27,47,.12)',
        }}
      />
    </Fill>
  );
}

/** 2–4 s: the drop. Alt + Shift + C, then "SCAN IT!". */
export function Drop({ t, L }: SceneProps) {
  const keys: [string, number][] = [
    ['ALT', 240],
    ['SHIFT', 340],
    ['C', 200],
  ];
  const all = at(0, 3);
  const keyH = pick(L, 190, 170, 190);
  const gap = 36;
  const rowW = keys.reduce((s, [, w]) => s + w * (keyH / 190), 0) + gap * 2;
  let x = L.W / 2 - rowW / 2;
  const rowY = pick(L, L.H * 0.56, L.H * 0.56, L.H * 0.52);
  return (
    <Fill>
      <Sunburst t={t} speed={10} />
      <Halftone opacity={0.18} inner={30} />
      {keys.map(([k, w], i) => {
        const kw = w * (keyH / 190);
        const kt = at(0, i);
        const left = x;
        x += kw + gap;
        const s = pop(t, kt, 0.22);
        const pressed = Math.max(
          prog(t, kt + 0.08, 0.06) * (1 - prog(t, kt + 0.2, 0.1)),
          t > all ? 1 - prog(t, all + 0.12, 0.2) : 0,
        );
        return (
          <div
            key={k}
            style={{
              position: 'absolute',
              left,
              top: rowY,
              transform: `scale(${s}) rotate(${(i - 1) * 4}deg)`,
            }}
          >
            <Keycap
              label={k}
              w={kw}
              h={keyH}
              pressed={pressed}
              fontSize={k.length > 1 ? keyH * 0.3 : keyH * 0.5}
            />
          </div>
        );
      })}
      {[0, 1].map((i) => {
        const plusT = at(0, i + 1);
        const px =
          L.W / 2 - rowW / 2 + (i === 0 ? 240 : 580) * (keyH / 190) + (i === 0 ? 0 : gap) + 4;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: px,
              top: rowY + keyH * 0.32,
              fontFamily: FONT.display,
              fontWeight: 700,
              fontSize: 60,
              color: C.white,
              textShadow: outline(5),
              transform: `scale(${pop(t, plusT, 0.2)})`,
            }}
          >
            +
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: pick(L, L.H * 0.1, L.H * 0.17, L.H * 0.22),
          display: 'flex',
          justifyContent: 'center',
          gap: 30,
        }}
      >
        <SlamText
          text="SCAN"
          t={t}
          start={at(0, 0)}
          size={pick(L, 230, 165, 210)}
          color={C.yellow}
          depthColor={C.purple}
          stagger={0.06}
          tilt={-4}
        />
        <SlamText
          text="IT!"
          t={t}
          start={all}
          size={pick(L, 230, 165, 210)}
          color={C.white}
          depthColor={C.red}
          stagger={0.05}
          tilt={-4}
        />
      </div>
      <Confetti
        t={t}
        start={all}
        x={L.W / 2}
        y={L.H * 0.4}
        count={50}
        spread={1300}
        size={26}
        seed={4}
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Sparkle
          key={i}
          t={t}
          phase={i}
          x={hash(i * 3) * L.W}
          y={hash(i * 5 + 1) * L.H * 0.9 + 40}
          size={50}
          color={[C.yellow, C.white, C.green][i % 3]}
        />
      ))}
    </Fill>
  );
}

/** 4–5 s: the critter hops in. */
export function CritterIntro({ t, lt, L }: SceneProps) {
  const size = pick(L, 512, 448, 512);
  const hop = Math.abs(Math.sin(Math.min(lt, 1) * Math.PI * 2)) * 40;
  const enter = easeOut(prog(lt, 0, 0.18));
  const bubbleK = pop(lt, 0.22, 0.25);
  const cx = pick(L, L.W * 0.42, L.W * 0.5, L.W * 0.5);
  const cy = pick(L, L.H * 0.56, L.H * 0.6, L.H * 0.58);
  return (
    <Fill>
      <Sunburst t={t} colors={[C.purple, C.shine]} base={C.yellow} rays={24} speed={14} />
      <Halftone color={C.purple} opacity={0.2} />
      <div
        style={{
          position: 'absolute',
          left: cx - size / 2,
          top: cy - size / 2 + (1 - enter) * L.H * 0.6 - hop,
        }}
      >
        <Critter size={size} mood={lt < 0.5 ? 'happy' : 'idle'} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: pick(L, cx + size * 0.38, cx - 300, cx - 300),
          top: pick(L, cy - size * 0.62, cy - size * 0.95, cy - size * 1.0),
          transform: `scale(${bubbleK})`,
          transformOrigin: 'bottom left',
        }}
      >
        <Pill
          style={{
            fontFamily: FONT.display,
            fontWeight: 700,
            fontSize: 52,
            padding: '18px 34px',
            borderRadius: 26,
          }}
        >
          let me measure that!
        </Pill>
      </div>
      <JpTab
        text="ひょうほん"
        t={lt}
        start={0.05}
        size={50}
        style={{ left: 40, top: pick(L, 120, 130, 340) }}
      />
    </Fill>
  );
}

/** 5–6 s: the scanner sweeps the page and colour comes back. */
export function Lab({ lt, L }: SceneProps) {
  const sw = pick(L, 1100, 900, 960);
  const sh = sw * 0.64;
  const p = easeInOut(prog(lt, 0.1, 0.75));
  const left = L.W / 2 - sw / 2 + pick(L, 60, 0, 0);
  const top = L.H / 2 - sh / 2 - pick(L, 50, 70, 120);
  const beamY = sh * p;
  return (
    <Fill style={{ background: C.night }}>
      <Fill
        style={{
          backgroundImage:
            'linear-gradient(rgba(124,108,245,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(124,108,245,.12) 1px,transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left,
          top,
          transform: `scale(${0.96 + 0.04 * easeOut(prog(lt, 0, 0.2))})`,
        }}
      >
        <FakeSite w={sw} h={sh} color={0} />
        <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 ${100 - p * 100}% 0)` }}>
          <FakeSite w={sw} h={sh} color={1} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: -40,
            right: -40,
            top: beamY - 6,
            height: 12,
            background: C.shine,
            boxShadow: `0 0 40px 14px ${C.purple}`,
            opacity: p > 0 && p < 1 ? 1 : 0,
          }}
        />
        <div style={{ position: 'absolute', left: -110, top: beamY - 70 }}>
          <Critter
            size={112}
            mood="scanning"
            gaze={Math.floor(lt * 6) % 2 ? 'left' : 'right'}
            shadow={false}
          />
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: pick(L, 60, 60, 300),
          display: 'flex',
          justifyContent: 'center',
          transform: `scale(${pop(lt, 0.15, 0.25)})`,
        }}
      >
        <Pill
          style={{
            fontFamily: FONT.mono,
            fontWeight: 700,
            fontSize: pick(L, 32, 26, 26),
            letterSpacing: '0.04em',
          }}
        >
          {STATIONS.map((s, i) => (
            <span key={s} style={{ color: lt > 0.15 + i * 0.12 ? C.ink : '#B4B0C2' }}>
              {s}
              {i < STATIONS.length - 1 ? '  ▸' : ''}
            </span>
          ))}
        </Pill>
      </div>
    </Fill>
  );
}

const STATION_BG = [C.purple, C.yellow, C.green, C.red, C.blue];

/** 6–8.5 s: one measurement per beat. */
export function Stations({ t, lt, L }: SceneProps) {
  const i = Math.min(4, Math.floor(lt / 0.5));
  const st = at(2, i);
  const s = t - st;
  const name = STATIONS[i] as string;
  const bg = STATION_BG[i] as string;
  const cardW = pick(L, 1040, 900, 900);
  const cardH = pick(L, 560, 540, 640);
  const k = slam(t, st, 1.25, 0.1);
  return (
    <Fill style={{ background: bg }}>
      <Sunburst t={t} colors={[C.white]} base={bg} rays={32} speed={20} opacity={0.18} clear={0} />
      <Halftone opacity={0.22} />
      <div
        style={{
          position: 'absolute',
          left: L.W / 2 - cardW / 2,
          top: L.H / 2 - cardH / 2 + pick(L, 60, 80, 40),
          width: cardW,
          height: cardH,
          background: C.paper,
          border: `8px solid ${C.ink}`,
          borderRadius: 28,
          boxShadow: `16px 16px 0 ${C.ink}`,
          transform: `scale(${k}) rotate(${(i % 2 ? 1 : -1) * 1.5}deg)`,
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        <StationBody i={i} s={s} w={cardW} />
      </div>
      <div style={{ position: 'absolute', left: pick(L, 120, 40, 60), top: pick(L, 40, 30, 200) }}>
        <Burst
          label={name}
          size={pick(L, 520, 470, 520)}
          fill={i === 1 ? C.purple : C.yellow}
          color={i === 1 ? C.white : C.ink}
          t={t}
          start={st}
          rot={-8}
        />
      </div>
      <Confetti t={t} start={st} x={L.W / 2} y={L.H / 2} count={18} spread={900} seed={i + 9} />
    </Fill>
  );
}

function StationBody({ i, s, w }: { i: number; s: number; w: number }) {
  const label = { fontFamily: FONT.mono, fontWeight: 700, fontSize: 24, color: C.ink } as const;
  if (i === 0) {
    const sw: [string, string][] = [
      ['background', SITE.background],
      ['text', SITE.text],
      ['accent', SITE.accent],
      ['link', SITE.link],
      ['border', SITE.border],
    ];
    return (
      <div style={{ display: 'flex', gap: 22 }}>
        {sw.map(([role, hex], j) => {
          const k = pop(s, j * 0.04, 0.22);
          return (
            <div
              key={role}
              style={{
                transform: `scale(${k}) translateY(${(j % 2) * 26}px)`,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: w * 0.15,
                  height: w * 0.19,
                  background: hex,
                  border: `6px solid ${C.ink}`,
                  borderRadius: 18,
                  boxShadow: `6px 6px 0 ${C.ink}`,
                }}
              />
              <div style={{ ...label, marginTop: 14, fontSize: 22 }}>{role}</div>
              <div style={{ ...label, fontWeight: 500, fontSize: 20 }}>{hex}</div>
            </div>
          );
        })}
      </div>
    );
  }
  if (i === 1) {
    const sizes: [number, string][] = [
      [44, 'display 44 · 700'],
      [24, 'heading 24 · 700'],
      [16, 'body 16 · 500'],
    ];
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 60 }}>
        <div
          style={{
            fontFamily: FONT.body,
            fontWeight: 800,
            fontSize: 260,
            lineHeight: 1,
            color: SITE.text,
            transform: `scale(${pop(s, 0, 0.25)})`,
            letterSpacing: '-0.05em',
          }}
        >
          Aa
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {sizes.map(([px, l], j) => (
            <div key={l} style={{ opacity: s > j * 0.05 ? 1 : 0 }}>
              <div
                style={{
                  fontFamily: FONT.body,
                  fontWeight: 700,
                  fontSize: px * 1.6,
                  color: SITE.text,
                  lineHeight: 1.1,
                }}
              >
                Hello
              </div>
              <div style={{ ...label, fontSize: 20, color: SITE.muted }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (i === 2) {
    const steps = [4, 8, 12, 16, 24, 32, 48];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map((v, j) => (
          <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ ...label, width: 60, textAlign: 'right' }}>{v}</div>
            <div
              style={{
                height: 34,
                width: (v / 48) * w * 0.62 * easeOut(prog(s, j * 0.03, 0.2)),
                background: C.purple,
                border: `4px solid ${C.ink}`,
                borderRadius: 4,
              }}
            />
          </div>
        ))}
      </div>
    );
  }
  if (i === 3) {
    const radii: [number, string][] = [
      [8, '8px'],
      [24, '24px'],
      [999, '999px'],
    ];
    return (
      <div style={{ display: 'flex', gap: 60 }}>
        {radii.map(([r, l], j) => {
          const p = easeOut(prog(s, j * 0.05, 0.3));
          return (
            <div key={l} style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 200,
                  height: 200,
                  background: [SITE.accent, SITE.link, C.yellow][j],
                  border: `7px solid ${C.ink}`,
                  borderRadius: Math.min(r, 100) * p,
                  boxShadow: `7px 7px 0 ${C.ink}`,
                }}
              />
              <div style={{ ...label, marginTop: 18, fontSize: 28 }}>{l}</div>
            </div>
          );
        })}
      </div>
    );
  }
  const elev = [
    '0 2px 4px rgba(31,27,22,.12)',
    '0 10px 24px rgba(31,27,22,.18)',
    '0 28px 60px rgba(31,27,22,.28)',
  ];
  return (
    <div style={{ display: 'flex', gap: 60 }}>
      {elev.map((sh, j) => {
        const lift = easeOut(prog(s, j * 0.05, 0.3));
        return (
          <div key={sh} style={{ textAlign: 'center' }}>
            <div
              style={{
                width: 210,
                height: 160,
                background: C.white,
                borderRadius: 18,
                boxShadow: sh,
                transform: `translateY(${-lift * (j + 1) * 8}px)`,
              }}
            />
            <div style={{ ...label, marginTop: 30, fontSize: 24 }}>elev {j + 1}</div>
          </div>
        );
      })}
    </div>
  );
}

/** 8.5–10 s: wordmark sting. */
export function Logo({ t, lt, L }: SceneProps) {
  const boxW = pick(L, 1080, 920, 920);
  const reveal = easeOut(prog(lt, 0.05, 0.4));
  const k = pop(lt, 0, 0.3);
  return (
    <Fill>
      <Sunburst t={t} speed={4} opacity={0.55} />
      <Halftone opacity={0.3} size={18} dot={4} inner={25} />
      <div
        style={{
          position: 'absolute',
          left: L.W / 2 - boxW / 2,
          top: L.H / 2 - pick(L, 170, 170, 260),
          width: boxW,
          padding: '56px 0',
          background: C.white,
          border: `9px solid ${C.ink}`,
          borderRadius: 40,
          boxShadow: `18px 18px 0 ${C.ink}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 40,
          transform: `scale(${k}) rotate(-2deg)`,
        }}
      >
        <Critter size={150} mood="happy" shadow={false} />
        <Wordmark height={boxW * 0.11} color={C.ink} reveal={reveal} shadow={C.purple} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: L.H / 2 + pick(L, 150, 150, 70),
          textAlign: 'center',
          fontFamily: FONT.body,
          fontWeight: 800,
          fontSize: pick(L, 54, 46, 50),
          color: C.ink,
          opacity: prog(lt, 0.45, 0.2),
        }}
      >
        <span
          style={{
            background: C.yellow,
            border: `5px solid ${C.ink}`,
            borderRadius: 16,
            padding: '6px 22px',
            boxShadow: `6px 6px 0 ${C.ink}`,
          }}
        >
          Scan any website's design.
        </span>
      </div>
      <JpTab
        text="スペシメン"
        t={lt}
        start={0.1}
        size={52}
        style={{ left: pick(L, 70, 40, 50), top: pick(L, 160, 120, 300) }}
      />
      {[0, 1, 2, 3].map((i) => (
        <Sparkle
          key={i}
          t={t}
          phase={i * 2}
          x={L.W / 2 + Math.cos(i * 1.7) * boxW * 0.55}
          y={L.H / 2 - 40 + Math.sin(i * 1.7) * 260}
          size={56}
          color={[C.yellow, C.purple, C.green, C.red][i]}
        />
      ))}
    </Fill>
  );
}
