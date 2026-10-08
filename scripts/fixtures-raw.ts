// Usage: pnpm fixtures:raw
// Runs the sampler IIFE over every ground-truth fixture page (those with a *.expected.json)
// and writes fixtures/raw/pages/<name>.json. The extractor unit tests read these files.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startFixtureServer } from '../fixtures/serve';

const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync('pnpm', ['-F', '@specimen/extension', 'build:sampler'], {
  cwd: root,
  stdio: 'inherit',
});
const samplerPath = join(root, 'apps/extension/.output/sampler.iife.js');
const pagesDir = join(root, 'fixtures/pages');
const outDir = join(root, 'fixtures/raw/pages');
mkdirSync(outDir, { recursive: true });

const names = readdirSync(pagesDir)
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, ''))
  .filter((n) => existsSync(join(pagesDir, `${n}.expected.json`)));

const server = await startFixtureServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  ).newPage();
  for (const name of names) {
    await page.goto(`${server.url}/${name}.html`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ path: samplerPath });
    const raw = await page.evaluate(
      // biome-ignore lint/suspicious/noExplicitAny: injected global
      () => (globalThis as any).__specimenSample(),
    );
    // Stable, port-independent URL so regenerated files diff cleanly.
    raw.url = `http://fixtures.local/${name}.html`;
    raw.scannedAt = 0;
    writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(raw)}\n`);
    console.log(`${name}: ${raw.samples.length} samples, ${raw.sections.length} sections`);
  }
} finally {
  await browser.close();
  await server.close();
}
