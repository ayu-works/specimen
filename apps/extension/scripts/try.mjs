// Opens a visible Chromium window with the extension loaded, for manual testing.
// Usage: pnpm -F @specimen/extension try [url]   (run `pnpm dev` or `pnpm build` first)
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const dev = path.join(root, '.output/chrome-mv3-dev');
const prod = path.join(root, '.output/chrome-mv3');
const ext = existsSync(dev) ? dev : prod;
const url = process.argv[2] ?? 'https://linear.app';

const context = await chromium.launchPersistentContext(
  mkdtempSync(path.join(tmpdir(), 'specimen-try-')),
  {
    channel: 'chromium',
    headless: false,
    viewport: null,
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      '--window-size=1440,900',
    ],
  },
);
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url);
console.log(
  `Loaded ${path.relative(root, ext)} — click the puzzle icon → pin Specimen → click it.`,
);
console.log('Close the browser window (or Ctrl-C) to stop.');
context.on('close', () => process.exit(0));
