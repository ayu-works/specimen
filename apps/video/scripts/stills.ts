/** Renders stills for review: tsx scripts/stills.ts <outDir> <comp> <sec...> */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [out, ids, ...secs] = process.argv.slice(2);
const serveUrl = await bundle({
  entryPoint: join(root, 'src/index.ts'),
  publicDir: join(root, 'public'),
});
for (const id of (ids ?? 'Promo16x9').split(',')) {
  const composition = await selectComposition({ serveUrl, id });
  for (const s of secs) {
    const frame = Math.round(Number(s) * composition.fps);
    await renderStill({
      composition,
      serveUrl,
      frame,
      output: join(out as string, `${id}-${String(s).padStart(5, '0')}.png`),
      imageFormat: 'png',
    });
  }
}
console.log('done');
