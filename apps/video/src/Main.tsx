import type { FC } from 'react';
import { AbsoluteFill, Audio, staticFile } from 'remotion';
import { prog, shake, useLayout, useTime, VariantContext } from './anim';
import { Grain } from './components/fx';
import { Hud } from './components/type';
import { Callback, End, Free, Library, Punch, Stamps } from './scenes/end';
import { Build, Handoff, Measured, Prompt, Roles, Stage } from './scenes/middle';
import { Cold, CritterIntro, Drop, Lab, Logo, type SceneProps, Stations } from './scenes/open';
import { SCENES, type SceneId, SFX, VARIANTS, type Variant, type VariantId } from './timeline';

const SCENE: Record<SceneId, FC<SceneProps>> = {
  cold: Cold,
  drop: Drop,
  critter: CritterIntro,
  lab: Lab,
  stations: Stations,
  logo: Logo,
  measured: Measured,
  roles: Roles,
  prompt: Prompt,
  handoff: Handoff,
  build: Build,
  stage: Stage,
  stamps: Stamps,
  free: Free,
  library: Library,
  callback: Callback,
  punch: Punch,
  end: End,
};
const DARK: SceneId[] = ['lab', 'measured', 'handoff', 'stage', 'library'];
const IMPACTS = SFX.filter((e) => e.kind === 'slam' || e.kind === 'stamp').map((e) => e.t);

export type MainProps = { variant: VariantId; audio: string };

/** One variant of the film: its speed stretches the timeline, `audio` is its matching soundtrack. */
export const Main = ({ variant, audio }: MainProps) => (
  <VariantContext.Provider value={VARIANTS.find((v) => v.id === variant) as Variant}>
    <Film audio={audio} />
  </VariantContext.Provider>
);

const Film = ({ audio }: { audio: string }) => {
  const t = useTime();
  const L = useLayout();
  let idx = 0;
  for (let i = 0; i < SCENES.length; i++) if (t >= (SCENES[i]?.[1] ?? 0)) idx = i;
  const [id, start] = SCENES[idx] as [SceneId, number];
  const Scene = SCENE[id];
  const lt = t - start;
  // Every cut lands with a small punch-in; slams and stamps shake the camera.
  const punch = 1 + 0.05 * (1 - prog(lt, 0, 0.14));
  const sh = IMPACTS.reduce(
    (a, s) => {
      const o = shake(t, s, 12);
      return { x: a.x + o.x, y: a.y + o.y };
    },
    { x: 0, y: 0 },
  );
  const hudScale = L.min / 1080;
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) scale(${punch})` }}>
        <Scene t={t} lt={lt} L={L} />
      </AbsoluteFill>
      <Grain opacity={id === 'cold' || id === 'callback' ? 0.16 : 0.08} />
      {id !== 'end' && <Hud t={t} scale={hudScale * (L.tall ? 1.1 : 1)} dark={DARK.includes(id)} />}
      <Audio src={staticFile(audio)} />
    </AbsoluteFill>
  );
};
