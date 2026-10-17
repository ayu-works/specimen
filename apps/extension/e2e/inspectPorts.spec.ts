import type { Page } from '@playwright/test';
import { startFixtureServer } from '../../../fixtures/serve';
import { expect, test } from './fixtures';
import { type Fixtures, goTab, openPanel, openTarget, press, scanFixture } from './helpers';

declare global {
  interface Window {
    __got?: Record<string, unknown[]>;
    __probe?: { disconnects: number; errors: string[] };
    __port?: chrome.runtime.Port;
  }
}

/**
 * T1.38 (SPC-27), the real Chrome paths no unit fake shows: one receiver's `port.disconnect()`
 * closes the channel for the sender and every other receiver (lens A r1 probe), so with the
 * panel's real Inspect on, Ports it doesn't own must stay alive for their real receiver; and the
 * overlay connects while it handles `overlay.set`, so Inspect must already be listening then.
 */
test.describe('T1.38 Inspect Port listener (full extension)', () => {
  let fixtures: Fixtures;
  test.beforeAll(async () => {
    fixtures = await startFixtureServer();
  });
  test.afterAll(async () => {
    await fixtures.close();
  });

  /** An extension page that records every message on Ports with these names. */
  async function host(page: Page, extensionId: string, names: string[]) {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.evaluate((ns) => {
      window.__got = Object.fromEntries(ns.map((n) => [n, []]));
      chrome.runtime.onConnect.addListener((port) => {
        const box = window.__got?.[port.name];
        if (box) port.onMessage.addListener((m) => box.push(m));
      });
    }, names);
  }
  const got = (page: Page, name: string) => page.evaluate((n) => window.__got?.[n] ?? [], name);

  async function inspectOn(
    context: import('@playwright/test').BrowserContext,
    extensionId: string,
  ) {
    const url = `${fixtures.url}/landing-basic.html`;
    const target = await openTarget(context, url);
    const panel = await openPanel(context, extensionId, { shimUrl: url });
    await scanFixture(panel, target);
    await goTab(panel, 'Inspect');
    await press(panel.getByRole('button', { name: 'Inspect', exact: true }));
    await expect(panel.getByTestId('inspector-card')).toBeVisible();
    return { target, panel };
  }

  test('T1.38 a council Port opened elsewhere still reaches its host while Inspect is on', async ({
    context,
    extensionId,
  }) => {
    const hostPage = await context.newPage();
    await host(hostPage, extensionId, ['council']);
    await inspectOn(context, extensionId);

    const sender = await context.newPage();
    await sender.goto(`chrome-extension://${extensionId}/options.html`);
    await sender.evaluate(() => {
      window.__probe = { disconnects: 0, errors: [] };
      const port = chrome.runtime.connect({ name: 'council' });
      port.onDisconnect.addListener(() => {
        if (window.__probe) window.__probe.disconnects++;
      });
      window.__port = port;
      port.postMessage('first');
    });
    await expect.poll(() => got(hostPage, 'council')).toEqual(['first']);
    // Give the panel's Inspect listener time to act on the Port (the bug disconnected it here).
    await sender.waitForTimeout(1000);
    const probe = await sender.evaluate(() => {
      try {
        window.__port?.postMessage('second');
      } catch (e) {
        window.__probe?.errors.push(String(e));
      }
      return window.__probe;
    });
    expect(probe).toEqual({ disconnects: 0, errors: [] });
    await expect.poll(() => got(hostPage, 'council')).toEqual(['first', 'second']);
    await sender.evaluate(() => window.__port?.disconnect());
  });

  test('T1.38 the real Inspect button streams hovers to the card, again after leaving the view', async ({
    context,
    extensionId,
  }) => {
    const { target, panel } = await inspectOn(context, extensionId);
    const card = panel.getByTestId('inspector-card');
    const box = await target.locator('h1').first().boundingBox();
    const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const hoverShows = () =>
      expect
        .poll(
          async () => {
            await target.bringToFront();
            await target.mouse.move(cx - 5, cy);
            await target.mouse.move(cx, cy, { steps: 4 });
            return card.textContent();
          },
          { timeout: 10_000, intervals: [200, 400, 800] },
        )
        .toMatch(/^(h1|span|em|strong|br) · \d+×\d+/);

    await hoverShows();
    await expect(card).toContainText('fontSize: 56px'); // landing-basic h1

    // Leaving the view turns the overlay off; coming back and turning Inspect on works again.
    await goTab(panel, 'Scan');
    await goTab(panel, 'Inspect');
    await press(panel.getByRole('button', { name: 'Inspect', exact: true }));
    await expect(card).toContainText('Hover an element on the page');
    await hoverShows();
  });
});
