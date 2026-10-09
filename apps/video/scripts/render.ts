/**
 * Renders every variant × format to out/ (specimen-promo-30s-16x9.mp4, …).
 * Run after `pnpm music`.
 *   pnpm -F @specimen/video render                  # all six
 *   pnpm -F @specimen/video render Promo40s-9x16    # one
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { FORMATS, VARIANTS } from '../src/timeline';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2);
const ids = only.length
  ? only
  : VARIANTS.flatMap((v) => FORMATS.map((f) => `Promo${v.id}-${f.id}`));
const fileName = (id: string) => `specimen-promo-${id.replace(/^Promo/, '')}.mp4`;

const serveUrl = await bundle({
  entryPoint: join(root, 'src/index.ts'),
  publicDir: join(root, 'public'),
});
for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id });
  const outputLocation = join(root, 'out', fileName(id));
  let last = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 18,
    audioCodec: 'aac',
    audioBitrate: '192k',
    outputLocation,
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 10);
      if (p !== last) {
        last = p;
        process.stdout.write(`${id} ${p * 10}%\n`);
      }
    },
  });
  console.log(`wrote ${outputLocation}`);
}
