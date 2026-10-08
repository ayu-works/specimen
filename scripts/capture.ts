// Usage: pnpm capture <url> [name]
// Samples a live site with the same sampler the extension uses and saves the RawPage to
// fixtures/raw/<name>.json (default name = hostname without www / TLD).
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const [urlArg, nameArg] = process.argv.slice(2);
if (!urlArg) {
  console.error('Usage: pnpm capture <url> [name]');
  process.exit(2);
}
const url = /^https?:\/\//.test(urlArg) ? urlArg : `https://${urlArg}`;
const name =
  nameArg ??
  new URL(url).hostname
    .replace(/^www\./, '')
    .split('.')
    .slice(0, -1)
    .join('-');

// Always rebuild so the capture uses the current sampler source.
execFileSync('pnpm', ['-F', '@specimen/extension', 'build:sampler'], {
  cwd: root,
  stdio: 'inherit',
});
const samplerPath = join(root, 'apps/extension/.output/sampler.iife.js');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: UA,
    locale: 'en-US',
    bypassCSP: true, // the sampler is injected as an inline script; strict site CSPs would block it
  });
  const page = await context.newPage();

  // Stand-in for the extension's `css.fetch`: Node fetches cross-origin stylesheets (no CORS).
  await page.exposeFunction('__specimenFetchCss', async (urls: string[]) =>
    Promise.all(
      urls.map(async (u) => {
        try {
          if (!/^https?:/i.test(u)) return null;
          const res = await fetch(u, {
            headers: { 'user-agent': UA },
            signal: AbortSignal.timeout(8000),
          });
          return res.ok ? (await res.text()).slice(0, 2_000_000) : null;
        } catch {
          return null;
        }
      }),
    ),
  );

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {
    console.warn('load event did not fire within 15s; continuing');
  });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
    console.warn('network did not go idle within 15s; continuing');
  });
  // Scroll to the bottom and back to trigger lazy content.
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight + step; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
  });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

  await page.addScriptTag({ path: samplerPath });
  const raw = await page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: injected global
    () => (globalThis as any).__specimenSample(),
  );

  const outDir = join(root, 'fixtures/raw');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${name}.json`);
  writeFileSync(out, `${JSON.stringify(raw)}\n`);
  const kb = (statSync(out).size / 1024).toFixed(0);
  console.log(
    `${name}: ${kb} KB · ${raw.samples.length} samples · ${raw.sections.length} sections · ` +
      `${Object.keys(raw.rootVars).length} vars · ${raw.mediaQueries.length} media · ` +
      `${raw.fontFaces.length} fonts · warnings: ${JSON.stringify(raw.warnings)} -> ${dirname(out)}/${name}.json`,
  );
} finally {
  await browser.close();
}
