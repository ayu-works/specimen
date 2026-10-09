/**
 * Renders every cut × format into one folder per cut, e.g.
 *   out/1-main-mix/specimen-main-mix-landscape-16x9.mp4
 * Run after `pnpm music`.
 *   pnpm -F @specimen/video render                  # all twelve
 *   pnpm -F @specimen/video render Promomix-9x16    # one
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { FORMATS, VARIANTS, type VariantId } from '../src/timeline';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2);
const ids = only.length
  ? only
  : VARIANTS.flatMap((v) => FORMATS.map((f) => `Promo${v.id}-${f.id}`));
// Numbered so the approved cut sorts first.
const FOLDERS: Record<VariantId, string> = {
  mix: '1-main-mix',
  '30s': '2-chiptune-30s',
  '40s': '3-chiptune-40s-slow',
  suno: '4-suno-only',
};
const SHAPES: Record<(typeof FORMATS)[number]['id'], string> = {
  '16x9': 'landscape-16x9',
  '1x1': 'square-1x1',
  '9x16': 'vertical-9x16',
};
/** "Promomix-1x1" → out/1-main-mix/specimen-main-mix-square-1x1.mp4 */
const outPath = (id: string) => {
  const [variant, format] = id.replace(/^Promo/, '').split('-') as [VariantId, keyof typeof SHAPES];
  const folder = FOLDERS[variant];
  mkdirSync(join(root, 'out', folder), { recursive: true });
  return join(root, 'out', folder, `specimen-${folder.replace(/^\d-/, '')}-${SHAPES[format]}.mp4`);
};

const serveUrl = await bundle({
  entryPoint: join(root, 'src/index.ts'),
  publicDir: join(root, 'public'),
});
for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id });
  const outputLocation = outPath(id);
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
