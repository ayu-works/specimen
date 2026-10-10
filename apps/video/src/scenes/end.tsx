import { easeOut, hash, pick, pop, prog } from '../anim';
import { Critter, type Mood } from '../components/Critter';
import { Confetti, Fill, Halftone, Sparkle, Sunburst } from '../components/fx';
import { JpTab, Pill, SlamText, Stamp } from '../components/type';
import { Win, Wordmark } from '../components/ui';
import { C, FONT } from '../theme';
import { at, CALLBACK_TYPED } from '../timeline';
import { Cold, type SceneProps } from './open';

const field = (label: string, value: string) => (
  <div style={{ marginBottom: 18 }}>
    <div
      style={{
        fontFamily: FONT.body,
        fontWeight: 700,
        fontSize: 24,
        color: C.ink,
        marginBottom: 6,
      }}
    >
      {label}
    </div>
    <div
      style={{
        height: 52,
        border: `4px solid ${C.ink}`,
        borderRadius: 10,
        background: '#F1ECE3',
        fontFamily: FONT.mono,
        fontSize: 22,
        color: '#8b8798',
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
      }}
    >
      {value}
    </div>
  </div>
);

/** 22–24 s: the things Specimen doesn't have, stamped out. */
export function Stamps({ t, lt, L }: SceneProps) {
  const ww = pick(L, 500, 440, 620);
  const wh = pick(L, 440, 400, 400);
  const pos = pick<[number, number][]>(
    L,
    [
      [130, 230],
      [710, 320],
      [1290, 210],
    ],
    [
      [40, 90],
      [600, 250],
      [200, 560],
    ],
    [
      [60, 260],
      [400, 760],
      [60, 1260],
    ],
  );
  const wins = [
    {
      title: 'account.exe',
      body: (
        <>
          <div
            style={{
              fontFamily: FONT.body,
              fontWeight: 800,
              fontSize: 40,
              color: C.ink,
              marginBottom: 14,
            }}
          >
            Sign up
          </div>
          {field('Email', 'you@email.com')}
          {field('Password', '••••••••')}
        </>
      ),
      stamp: ['NO ACCOUNT', C.red] as const,
      st: at(10, 1),
      bar: C.pink,
    },
    {
      title: 'upload.exe',
      body: (
        <>
          <div style={{ fontFamily: FONT.mono, fontSize: 26, color: C.ink, marginTop: 10 }}>
            Sending page to server…
          </div>
          <div
            style={{
              height: 46,
              border: `4px solid ${C.ink}`,
              borderRadius: 10,
              marginTop: 40,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${8 + 60 * easeOut(prog(lt, 0, 1))}%`,
                background: `repeating-linear-gradient(45deg, ${C.green} 0 14px, #05b386 14px 28px)`,
              }}
            />
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 24, color: '#8b8798', marginTop: 16 }}>
            {Math.round(8 + 60 * easeOut(prog(lt, 0, 1)))}%
          </div>
        </>
      ),
      stamp: ['NO SERVER', C.purple] as const,
      st: at(10, 2),
      bar: C.green,
    },
    {
      title: 'telemetry.log',
      body: (
        <div style={{ fontFamily: FONT.mono, fontSize: 22, color: '#4a4766', lineHeight: 1.7 }}>
          {[
            'POST /track  page_view',
            'POST /track  click',
            'POST /track  scroll',
            'POST /track  session',
          ].map((x, i) => (
            <div key={x} style={{ opacity: lt > i * 0.15 ? 1 : 0 }}>
              {x}
            </div>
          ))}
        </div>
      ),
      stamp: ['NO TRACKING', C.blue] as const,
      st: at(10, 3),
      bar: C.yellow,
    },
  ];
  return (
    <Fill style={{ background: C.paper }}>
      <Halftone opacity={0.12} inner={0} />
      {[C.yellow, C.green, C.pink, C.shine, C.blue].map((c, i) => (
        <div
          key={c}
          style={{
            position: 'absolute',
            left: hash(i * 3) * L.W - 100,
            top: hash(i * 7 + 2) * L.H - 80,
            width: 260,
            height: 180,
            background: c,
            opacity: 0.55,
            transform: `rotate(${(hash(i) - 0.5) * 30}deg)`,
          }}
        />
      ))}
      {wins.map((w, i) => {
        const [x, y] = pos[i] as [number, number];
        return (
          <div key={w.title}>
            <Win
              title={w.title}
              w={ww}
              h={wh}
              bar={w.bar}
              style={{
                left: x,
                top: y,
                transform: `rotate(${(i - 1) * 3}deg) scale(${pop(lt, i * 0.06, 0.25)})`,
              }}
            >
              {w.body}
            </Win>
            <div
              style={{
                position: 'absolute',
                left: x + ww / 2,
                top: y + wh / 2,
                transform: 'translate(-50%,-50%)',
              }}
            >
              <Stamp
                text={w.stamp[0]}
                color={w.stamp[1]}
                t={t}
                start={w.st}
                size={pick(L, 78, 70, 92)}
                rot={-14 + i * 9}
              />
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: pick(L, 700, 600, 560),
          top: pick(L, 60, 975, 140),
          transform: `rotate(4deg) scale(${pop(lt, 0.1, 0.25)})`,
        }}
      >
        <Pill bg={C.yellow} style={{ fontFamily: FONT.display, fontSize: 34, fontWeight: 700 }}>
          RUNS IN YOUR BROWSER
        </Pill>
      </div>
      <JpTab
        text="ログイン不要"
        t={lt}
        start={0.2}
        size={40}
        bg={C.white}
        style={{ right: pick(L, 40, 30, 40), top: pick(L, 600, 620, 1500) }}
      />
    </Fill>
  );
}

/** 24–26 s: free and open source; the crew marches past. */
export function Free({ t, lt, L }: SceneProps) {
  const size = pick(L, 170, 150, 180);
  const moods: Mood[] = ['happy', 'scanning', 'idle', 'thinking', 'happy', 'idle', 'scanning'];
  const floor = pick(L, L.H - 70, L.H - 60, L.H - 330);
  return (
    <Fill>
      <Sunburst t={t} colors={[C.green, C.yellow, C.blue, C.pink]} speed={12} />
      <Halftone opacity={0.18} />
      <div
        style={{
          position: 'absolute',
          left: L.W / 2,
          top: pick(L, L.H * 0.3, L.H * 0.27, L.H * 0.3),
          transform: 'translate(-50%,-50%)',
        }}
      >
        <Stamp
          text="FREE"
          color={C.red}
          t={t}
          start={at(11, 0)}
          size={pick(L, 200, 180, 210)}
          rot={-8}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: L.W / 2,
          top: pick(L, L.H * 0.56, L.H * 0.53, L.H * 0.5),
          transform: 'translate(-50%,-50%)',
        }}
      >
        <Stamp
          text="OPEN SOURCE"
          sub="MIT LICENSE"
          color={C.purple}
          t={t}
          start={at(11, 2)}
          size={pick(L, 130, 110, 110)}
          rot={5}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: pick(L, 90, 40, 60),
          top: pick(L, 60, 40, 220),
          transform: `scale(${pop(t, at(11, 1), 0.25)}) rotate(-5deg)`,
          transformOrigin: 'left top',
        }}
      >
        <Pill
          style={{
            fontFamily: FONT.body,
            fontWeight: 800,
            fontSize: pick(L, 32, 28, 32),
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 2,
          }}
        >
          <span style={{ fontFamily: FONT.display, fontSize: 24, color: C.purple }}>
            AI OPTIONAL
          </span>
          <span>Local Gemma or your own key</span>
        </Pill>
      </div>
      {moods.map((m, i) => {
        const x = ((lt * 260 + i * (size + 70)) % (L.W + size * 2)) - size;
        const hop = Math.abs(Math.sin((t - at(11)) * Math.PI * 2 + i)) * 26;
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: floor - size - hop }}>
            <Critter size={size} mood={m} gaze={i % 2 ? 'left' : 'right'} />
          </div>
        );
      })}
    </Fill>
  );
}

/** A saved scan card for the Library wall, with a generated palette. */
function SpecimenCard({ seed, w }: { seed: number; w: number }) {
  const hue = Math.floor(hash(seed) * 360);
  const sw = [0, 1, 2, 3, 4].map(
    (j) =>
      `hsl(${(hue + j * 40 * hash(seed + j)) % 360} ${40 + 50 * hash(seed * 3 + j)}% ${25 + 55 * hash(seed * 5 + j)}%)`,
  );
  return (
    <div
      style={{
        width: w,
        height: w * 0.72,
        background: C.white,
        border: `5px solid ${C.ink}`,
        borderRadius: 16,
        boxShadow: `6px 6px 0 ${C.ink}`,
        padding: w * 0.07,
        display: 'flex',
        flexDirection: 'column',
        gap: w * 0.05,
      }}
    >
      <div style={{ display: 'flex', gap: w * 0.03 }}>
        {sw.map((c) => (
          <div
            key={c}
            style={{
              flex: 1,
              height: w * 0.2,
              background: c,
              borderRadius: 6,
              border: `3px solid ${C.ink}`,
            }}
          />
        ))}
      </div>
      <div
        style={{
          fontFamily: FONT.body,
          fontWeight: 800,
          fontSize: w * 0.17,
          color: C.ink,
          lineHeight: 1,
        }}
      >
        Aa
      </div>
      <div style={{ height: w * 0.05, width: '70%', background: '#CFC9DD', borderRadius: 99 }} />
    </div>
  );
}

/** 26–27 s: the Library: every scan you make, saved. */
export function Library({ t, lt, L }: SceneProps) {
  const cw = 260;
  const cols = Math.ceil(L.W / (cw + 30)) + 4;
  const rows = Math.ceil(L.H / (cw * 0.72 + 30)) + 4;
  const zoom = 2.6 - 1.75 * easeOut(prog(lt, 0, 0.8));
  return (
    <Fill style={{ background: C.night }}>
      <div
        style={{
          position: 'absolute',
          left: L.W / 2,
          top: L.H / 2,
          transform: `translate(-50%,-50%) scale(${zoom}) rotate(-4deg)`,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cw}px)`, gap: 30 }}>
          {Array.from({ length: cols * rows }, (_, i) => (
            <SpecimenCard key={i} seed={i + 1} w={cw} />
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: pick(L, 70, 70, 300),
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <SlamText
          text="EVERY SCAN, SAVED."
          t={t}
          start={at(12, 0.4)}
          size={pick(L, 110, 74, 80)}
          color={C.yellow}
          depthColor={C.purple}
          stagger={0.02}
        />
      </div>
    </Fill>
  );
}

/** 27–27.5 s: back to grey for a beat. */
export const Callback = (p: SceneProps) => <Cold {...p} typed={CALLBACK_TYPED} />;

/** 27.5–28 s: the punchline. */
export function Punch({ t, lt, L }: SceneProps) {
  const flash = 1 - prog(lt, 0, 0.12);
  const pw = pick(L, 440, 380, 460);
  return (
    <Fill>
      <Sunburst t={t} speed={25} />
      <Halftone opacity={0.2} />
      <div
        style={{
          position: 'absolute',
          left: pick(L, 140, 60, 0),
          right: pick(L, undefined, undefined, 0),
          top: pick(L, 260, 90, 280),
          display: 'flex',
          flexDirection: 'column',
          alignItems: pick(L, 'flex-start', 'flex-start', 'center'),
        }}
      >
        <SlamText
          text="NOW IT'S"
          t={t}
          start={at(12, 3)}
          size={pick(L, 150, 120, 130)}
          color={C.white}
          depthColor={C.purple}
          stagger={0.025}
          tilt={-4}
        />
        <SlamText
          text="A SPEC!"
          t={t}
          start={at(12, 3) + 0.12}
          size={pick(L, 190, 150, 170)}
          color={C.yellow}
          depthColor={C.red}
          stagger={0.025}
          tilt={-4}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: pick(L, L.W - pw - 180, L.W - pw - 60, L.W / 2 - pw / 2),
          top: pick(L, 170, 420, 820),
          width: pw,
          background: C.white,
          border: `6px solid ${C.ink}`,
          boxShadow: `12px 12px 0 ${C.ink}`,
          padding: `${pw * 0.06}px ${pw * 0.06}px ${pw * 0.2}px`,
          transform: `rotate(6deg) scale(${pop(lt, 0.02, 0.25)})`,
        }}
      >
        <div
          style={{
            background: C.yellow,
            display: 'grid',
            placeItems: 'center',
            aspectRatio: '1',
            border: `4px solid ${C.ink}`,
          }}
        >
          <Critter size={pw * 0.68} mood="happy" />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: pw * 0.05,
            textAlign: 'center',
            fontFamily: FONT.jp,
            fontSize: pw * 0.08,
            color: C.ink,
          }}
        >
          ひょうほん ♥ spec
        </div>
        <div
          style={{
            position: 'absolute',
            left: '35%',
            top: -24,
            width: '30%',
            height: 44,
            background: 'rgba(6,214,160,.7)',
            transform: 'rotate(-4deg)',
          }}
        />
      </div>
      <Fill style={{ background: C.white, opacity: flash }} />
    </Fill>
  );
}

/** 28–30 s: end card. */
export function End({ t, lt, L }: SceneProps) {
  const boxW = pick(L, 1000, 900, 920);
  const hop = Math.abs(Math.sin(lt * Math.PI * 2)) * 26;
  const cardW = 200;
  const strip = Math.ceil(L.W / (cardW + 24)) + 2;
  return (
    <Fill style={{ background: C.paper }}>
      <Sunburst t={t} speed={3} opacity={0.35} />
      <Halftone opacity={0.12} />
      <div
        style={{
          position: 'absolute',
          left: L.W / 2 - boxW / 2,
          top: pick(L, 150, 170, 420),
          width: boxW,
          padding: '46px 0',
          background: C.white,
          border: `9px solid ${C.ink}`,
          borderRadius: 40,
          boxShadow: `16px 16px 0 ${C.ink}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 36,
          transform: `scale(${pop(lt, 0, 0.3)}) rotate(-1.5deg)`,
        }}
      >
        <Critter size={140} mood="happy" shadow={false} />
        <Wordmark height={boxW * 0.105} color={C.ink} shadow={C.purple} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: pick(L, 470, 490, 760),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 26,
          opacity: prog(lt, 0.15, 0.2),
        }}
      >
        <Pill
          bg={C.yellow}
          style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: pick(L, 40, 34, 36) }}
        >
          github.com/ayu-works/specimen
        </Pill>
        <div
          style={{
            fontFamily: FONT.body,
            fontWeight: 800,
            fontSize: pick(L, 40, 34, 38),
            color: C.ink,
            textAlign: 'center',
            padding: '0 40px',
          }}
        >
          Free · Open source · Runs in your browser
        </div>
        <div
          style={{
            fontFamily: FONT.display,
            fontSize: pick(L, 28, 24, 28),
            color: C.purple,
            letterSpacing: '0.06em',
          }}
        >
          CHROME EXTENSION
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: pick(L, 120, 50, 80),
          top: pick(L, 620, 740, 1200) - hop,
        }}
      >
        <Critter size={pick(L, 200, 170, 220)} mood={Math.floor(lt * 2) % 2 ? 'happy' : 'idle'} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: pick(L, 150, 140, 190),
          background: C.ink,
          borderTop: `6px solid ${C.purple}`,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 24,
            padding: '20px 0',
            transform: `translateX(${-((lt * 120) % (cardW + 24))}px)`,
          }}
        >
          {Array.from({ length: strip }, (_, i) => (
            <div
              key={i}
              style={{
                flexShrink: 0,
                display: 'flex',
                gap: 6,
                width: cardW,
                height: pick(L, 100, 90, 140),
                background: '#24243d',
                borderRadius: 12,
                padding: 10,
              }}
            >
              {[0, 1, 2, 3].map((j) => (
                <div
                  key={j}
                  style={{
                    flex: 1,
                    borderRadius: 6,
                    background: `hsl(${Math.floor(hash(i * 4 + j + 50) * 360)} 70% ${45 + 25 * hash(i + j)}%)`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <Sparkle
          key={i}
          t={t}
          phase={i * 2}
          x={L.W * (0.12 + 0.38 * i)}
          y={pick(L, 110, 120, 340) + (i % 2) * 40}
          size={50}
          color={[C.yellow, C.purple, C.green][i]}
        />
      ))}
      <Confetti
        t={t}
        start={at(13)}
        x={L.W / 2}
        y={pick(L, 230, 250, 500)}
        count={30}
        seed={30}
        spread={1100}
      />
    </Fill>
  );
}
