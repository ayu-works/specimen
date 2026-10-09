import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { startFixtureServer } from '../../../fixtures/serve';
import { expect } from './fixtures';

export type Fixtures = Awaited<ReturnType<typeof startFixtureServer>>;

declare global {
  interface Window {
    __shimUrl?: string;
    __copied?: string[];
    __blobs?: { type: string; size: number }[];
    // biome-ignore lint/suspicious/noExplicitAny: injected test provider
    __specimenProvider?: any;
  }
}

/** Open a fixture page as a normal tab at desktop size. */
export async function openTarget(context: BrowserContext, url: string): Promise<Page> {
  const target = await context.newPage();
  await target.setViewportSize({ width: 1440, height: 900 });
  await target.goto(url);
  await target.bringToFront();
  return target;
}

interface PanelOptions {
  /** URL of the tab the panel treats as "the active tab" (can be changed with `retarget`). */
  shimUrl?: string;
  /** Extra script run before the panel loads (for example to inject a fake AI provider). */
  init?: () => void;
  /** Keep the automatic mobile capture on (default off: it opens a popup window per scan). */
  mobile?: boolean;
}

/**
 * Open the side panel as a normal tab. The panel is itself a tab, so `chrome.tabs.query` is
 * shimmed to return the fixture tab; clipboard writes and Blob downloads are recorded.
 */
export async function openPanel(
  context: BrowserContext,
  extensionId: string,
  opts: PanelOptions = {},
): Promise<Page> {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.addInitScript((u) => {
    window.__shimUrl = u;
    window.__copied = [];
    window.__blobs = [];
    const orig = chrome.tabs.query.bind(chrome.tabs);
    // biome-ignore lint/suspicious/noExplicitAny: test shim
    (chrome.tabs as any).query = async (q: chrome.tabs.QueryInfo) =>
      window.__shimUrl && (q.active || q.currentWindow) ? orig({ url: window.__shimUrl }) : orig(q);
    const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          window.__copied?.push(t);
          try {
            await write?.(t);
          } catch {
            /* no clipboard permission in this context: the recorded value is what matters */
          }
        },
        readText: async () => window.__copied?.at(-1) ?? '',
      },
    });
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b: Blob | MediaSource) => {
      if (b instanceof Blob) window.__blobs?.push({ type: b.type, size: b.size });
      return create(b);
    };
  }, opts.shimUrl ?? '');
  if (opts.init) await panel.addInitScript(opts.init);
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(
    (on) => chrome.storage.local.set({ 'settings.captureMobile': on }),
    opts.mobile === true,
  );
  return panel;
}

/** Point an open panel's "active tab" at another page. */
export function retarget(panel: Page, url: string) {
  return panel.evaluate((u) => {
    window.__shimUrl = u;
  }, url);
}

/** Click through `evaluate`: the 400px panel is small and some controls sit under the header. */
export const press = (loc: Locator) => loc.evaluate((el) => (el as HTMLElement).click());

export const goTab = (panel: Page, name: string) =>
  press(panel.getByRole('tab', { name, exact: true }));

/** Scan the fixture tab through the panel and wait for the result card. */
export async function scanFixture(panel: Page, target: Page): Promise<void> {
  await target.bringToFront(); // captureVisibleTab needs the tab to be visible
  await press(panel.getByRole('button', { name: /Scan this page/ }));
  await expect(panel.getByTestId('scan-result')).toBeVisible({ timeout: 25_000 });
}

/** Scan `name.html` in a fresh target tab with a fresh panel. */
export async function scanPage(
  context: BrowserContext,
  extensionId: string,
  fixtures: Fixtures,
  name: string,
  opts: Omit<PanelOptions, 'shimUrl'> = {},
): Promise<{ panel: Page; target: Page; url: string }> {
  const url = `${fixtures.url}/${name}.html`;
  const target = await openTarget(context, url);
  const panel = await openPanel(context, extensionId, { ...opts, shimUrl: url });
  await scanFixture(panel, target);
  return { panel, target, url };
}

/** Wait until the background has no pending extras (mobile/dark captures finished). */
export async function settleCaptures(panel: Page, ms = 25_000): Promise<void> {
  await expect(panel.getByText(/Capturing mobile/)).toHaveCount(0, { timeout: ms });
}
