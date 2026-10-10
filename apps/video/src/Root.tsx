import { Composition } from 'remotion';
import { Main } from './Main';
import { FORMATS, FPS, framesFor, VARIANTS } from './timeline';

/** Six compositions: {30s, 40s} × {16:9, 1:1, 9:16}, e.g. "Promo30s-16x9". */
export const Root = () => (
  <>
    {VARIANTS.flatMap((v) =>
      FORMATS.map((f) => (
        <Composition
          key={`${v.id}-${f.id}`}
          id={`Promo${v.id}-${f.id}`}
          component={Main}
          durationInFrames={framesFor(v)}
          fps={FPS}
          width={f.width}
          height={f.height}
          defaultProps={{ variant: v.id, audio: `audio-${v.id}.wav` }}
        />
      )),
    )}
  </>
);
