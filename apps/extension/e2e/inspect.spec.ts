import type { BrowserContext, Page } from '@playwright/test';
import { startFixtureServer } from '../../../fixtures/serve';
import { expect, test } from './fixtures';

declare global {
  interface Window {
    __hovers?: Record<string, unknown>[];
  }
}

test.describe('Phase 1 inspect flows (full extension)', () => {
  let fixtures: Awaited<ReturnType<typeof startFixtureServer>>;
  test.beforeAll(async () => {
    fixtures = await startFixtureServer();
  });
  test.afterAll(async () => {
    await fixtures.close();
  });

  const url = () => `${fixtures.url}/landing-basic.html`;

  async function openTarget(context: BrowserContext): Promise<Page> {
    const target = await context.newPage();
    await target.setViewportSize({ width: 1440, height: 900 });
    await target.goto(url());
    await target.bringToFront();
    return target;
  }

  /** Send a message to the background from the side-panel page, targeting the fixture tab. */
  function sendToFixtureTab(panel: Page, msg: Record<string, unknown>) {
    return panel.evaluate(
      async ([u, m]) => {
        const [tab] = await chrome.tabs.query({ url: u as string });
        if (!tab?.id) throw new Error(`no tab for ${u}`);
        return chrome.runtime.sendMessage({ ...(m as object), tabId: tab.id });
      },
      [url(), msg] as const,
    );
  }

  /** A stable fingerprint of the page's own styling that an overlay must never alter. */
  function styleFingerprint(page: Page) {
    return page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const sel of ['html', 'body', 'nav', 'h1', 'section', 'a', 'button', 'footer']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const cs = getComputedStyle(el);
        const props: string[] = [];
        for (let i = 0; i < cs.length; i++) {
          const p = cs.item(i);
          props.push(`${p}:${cs.getPropertyValue(p)}`);
        }
        out[sel] = props.join(';');
      }
      out.bodyChildren = String(document.body.children.length);
      out.scrollHeight = String(document.documentElement.scrollHeight);
      return out;
    });
  }

  const overlayHostCount = (page: Page) =>
    page.evaluate(
      () =>
        [...document.documentElement.children].filter(
          (e) =>
            e instanceof HTMLDivElement && e.style.zIndex === '2147483647' && e.shadowRoot === null,
        ).length,
    );

  test('T1.32 Scan on a fixture page → Inspect shows the expected accent hex', async ({
    context,
    extensionId,
  }) => {
    const target = await openTarget(context);
    const panel = await context.newPage();
    // The panel is itself a tab, so "active tab" would be the panel. Point the Scan button's
    // tab lookup at the fixture tab (test-only shim; the production code path is unchanged).
    await panel.addInitScript((u) => {
      const orig = chrome.tabs.query.bind(chrome.tabs);
      // biome-ignore lint/suspicious/noExplicitAny: test shim
      (chrome.tabs as any).query = async () => orig({ url: u });
    }, url());
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await target.bringToFront(); // captureVisibleTab needs the fixture tab to be visible

    await panel
      .getByRole('button', { name: /Scan this page/ })
      .evaluate((b) => (b as HTMLElement).click());
    await expect(panel.getByTestId('scan-result')).toBeVisible({ timeout: 20_000 });
    await panel
      .getByTestId('scan-result')
      .getByRole('button', { name: 'Inspect', exact: true })
      .evaluate((b) => (b as HTMLElement).click());
    await expect(panel.getByText('#5e6ad2').first()).toBeVisible();
    // Accent role swatch specifically.
    const accent = panel.locator('button', { hasText: /^accent\s*#5e6ad2$/i });
    await expect(accent.first()).toBeVisible();
  });

  test('T1.33 grid overlay toggles on/off and leaves the page’s computed styles unchanged', async ({
    context,
    extensionId,
  }) => {
    const target = await openTarget(context);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await target.bringToFront();

    const before = await styleFingerprint(target);
    expect(await overlayHostCount(target)).toBe(0);

    const gridSpec = { containerMaxWidth: 1200, gutter: 24, baseUnit: 8 };
    const on = await sendToFixtureTab(panel, { type: 'overlay.set', grid: true, gridSpec });
    expect(on.ok, JSON.stringify(on)).toBe(true);
    await expect.poll(() => overlayHostCount(target)).toBe(1);
    expect(await styleFingerprint(target)).toEqual(before);
    // The overlay lives in a closed shadow root: nothing of it leaks into the page's DOM/CSS.
    expect(
      await target.evaluate(() => document.querySelectorAll('[class*="specimen"]').length),
    ).toBe(0);

    const off = await sendToFixtureTab(panel, { type: 'overlay.set', grid: false });
    expect(off.ok, JSON.stringify(off)).toBe(true);
    // Toggling again is idempotent (single host) and the page is still untouched.
    expect(await overlayHostCount(target)).toBe(1);
    expect(await styleFingerprint(target)).toEqual(before);

    const again = await sendToFixtureTab(panel, { type: 'overlay.set', grid: true, gridSpec });
    expect(again.ok).toBe(true);
    expect(await overlayHostCount(target)).toBe(1);
  });

  test('T1.34 inspector hover streams the element’s styles over Port "inspector"', async ({
    context,
    extensionId,
  }) => {
    const target = await openTarget(context);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await target.bringToFront();

    // Listen for the content script's Port before enabling the inspector.
    await panel.evaluate(() => {
      window.__hovers = [];
      chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== 'inspector') return;
        port.onMessage.addListener((m) => window.__hovers?.push(m));
      });
    });

    const res = await sendToFixtureTab(panel, {
      type: 'overlay.set',
      inspector: true,
      tokens: [{ id: 'c1', hex: '#5e6ad2' }],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const h1 = target.locator('h1').first();
    const box = await h1.boundingBox();
    expect(box).not.toBeNull();
    const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    await expect
      .poll(
        async () => {
          await target.mouse.move(cx - 5, cy);
          await target.mouse.move(cx, cy, { steps: 4 });
          return panel.evaluate(() => window.__hovers?.length ?? 0);
        },
        { timeout: 10_000, intervals: [200, 400, 800] },
      )
      .toBeGreaterThan(0);

    const hovers = await panel.evaluate(() => window.__hovers ?? []);
    const last = hovers.at(-1) as {
      tag: string;
      rect: { w: number; h: number };
      styles: Record<string, string>;
    };
    expect(['h1', 'span', 'em', 'strong', 'br']).toContain(last.tag);
    expect(Object.keys(last.styles).sort()).toEqual(
      [
        'backgroundColor',
        'borderRadius',
        'color',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'lineHeight',
        'padding',
      ].sort(),
    );
    expect(last.styles.fontSize).toBe('56px'); // landing-basic h1
    expect(last.styles.fontWeight).toBe('700');
    expect(last.rect.w).toBeGreaterThan(0);

    await sendToFixtureTab(panel, { type: 'overlay.set', inspector: false });
  });
});
