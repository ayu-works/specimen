// Bundle the sampler into a single IIFE for Playwright tests and `pnpm capture`.
// Output: apps/extension/.output/sampler.iife.js (sets globalThis.__specimenSample).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/sampler/iife.ts'],
  outfile: '.output/sampler.iife.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  logLevel: 'warning',
});
