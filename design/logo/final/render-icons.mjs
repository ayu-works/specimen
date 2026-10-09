// Renders specimen-critter.svg to the extension icons (transparent PNGs) and a 512px master.
// Run from apps/extension: pnpm exec node ../../design/logo/final/render-icons.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, 'specimen-critter.svg'), 'utf8');
const iconDir = join(here, '../../../apps/extension/public/icon');
const targets = [16, 32, 48, 128].map((s) => [s, join(iconDir, `${s}.png`)]);
targets.push([512, join(here, 'specimen-critter-512.png')]);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [size, path] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path, omitBackground: true });
}
await browser.close();
