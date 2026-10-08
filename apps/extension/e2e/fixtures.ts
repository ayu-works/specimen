import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type BrowserContext, test as base, chromium } from '@playwright/test';

const extensionPath = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  swErrors: string[];
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'specimen-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium', // new headless mode, supports extensions
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },
  swErrors: async ({ context }, use) => {
    const errors: string[] = [];
    const attach = (w: import('@playwright/test').Worker) => {
      w.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    };
    for (const w of context.serviceWorkers()) attach(w);
    context.on('serviceworker', attach);
    context.on('weberror', (e) => errors.push(e.error().message));
    await use(errors);
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2] as string);
  },
});

export const expect = test.expect;
