import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type BrowserContext, test as base, chromium } from '@playwright/test';

const extensionPath = path.resolve(import.meta.dirname, '../.output-e2e/chrome-mv3');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  swErrors: string[];
  /**
   * Let every page keep its real window size. By default Playwright forces 1280x720 on every page
   * of the context, popups included, so a 390px `chrome.windows.create` popup reports 1280 (T5.03).
   */
  realWindows: boolean;
}>({
  realWindows: [false, { option: true }],
  context: async ({ realWindows }, use) => {
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'specimen-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium', // new headless mode, supports extensions
      headless: process.env.SPECIMEN_HEADED !== '1',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      ...(realWindows ? { viewport: null } : {}),
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
