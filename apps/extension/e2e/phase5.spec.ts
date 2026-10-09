import type { Page } from '@playwright/test';
import type { DesignScan, RawPage } from '@specimen/core/schema';
import { startFixtureServer } from '../../../fixtures/serve';
import { expect, test } from './fixtures';
import { goTab, openTarget, press, retarget, scanPage } from './helpers';

/** Read every scan row straight from the panel's IndexedDB (what the Library would show). */
function storedScans(panel: Page) {
  return panel.evaluate(
    () =>
      new Promise<DesignScan[]>((resolve, reject) => {
        const open = indexedDB.open('specimen');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('scans').objectStore('scans').getAll();
          all.onsuccess = () => {
            resolve(all.result as DesignScan[]);
            open.result.close();
          };
        };
      }),
  );
}

test.describe('Phase 5 capture and fidelity flows (full extension)', () => {
  let fixtures: Awaited<ReturnType<typeof startFixtureServer>>;
  test.beforeAll(async () => {
    fixtures = await startFixtureServer();
  });
  test.afterAll(async () => {
    await fixtures.close();
  });

  test('T5.02 hover and focus states are captured from the CSSOM', async ({
    context,
    extensionId,
    swErrors,
  }) => {
    const { panel, url } = await scanPage(context, extensionId, fixtures, 'components');

    // The raw sample carries the declared :hover/:focus overrides of the fixture's buttons.
    const raw = await panel.evaluate(async (u) => {
      const [tab] = await chrome.tabs.query({ url: u });
      const res = await chrome.runtime.sendMessage({
        type: 'scan.run',
        tabId: tab?.id,
        opts: { noScreenshot: true },
      });
      return (res as { data: { raw: RawPage } }).data.raw;
    }, url);
    const primary = raw.components?.find((c) => c.kind === 'button-primary');
    expect(primary, 'a primary button was detected').toBeTruthy();
    expect(primary?.states.hover?.['background-color']).toBe('#3b49c9');
    expect(primary?.states.focus?.outline).toMatch(/3px/);

    // And the saved scan keeps them, so the Inspect view can show them.
    const [saved] = await storedScans(panel);
    const spec = saved?.components?.find((c) => c.kind === 'button-primary');
    expect(spec?.states.hover?.['background-color']).toBe('#3b49c9');
    await goTab(panel, 'Inspect');
    await expect(panel.getByTestId('components-card')).toBeVisible();
    expect(swErrors).toEqual([]);
  });

  test('T5.03 mobile capture is a true phone width, or no mobile variant is stored', async ({
    context,
    extensionId,
    swErrors,
  }) => {
    const { panel } = await scanPage(context, extensionId, fixtures, 'landing-basic', {
      mobile: true,
    });
    const captures = panel.getByTestId('captures');
    // Either the capture finished ("Mobile captured · NNNpx") or it was refused as too wide.
    await expect(captures).toContainText(/Mobile\s*(captured|not captured)/, { timeout: 30_000 });
    const text = await captures.innerText();
    const [saved] = await storedScans(panel);

    const m = /captured[^\n]*?(\d+)px/.exec(text);
    if (saved?.variants?.mobile) {
      // A mobile variant must never come from a desktop-width window.
      const width = saved.variants.mobile.viewportWidth;
      expect(width, 'recorded viewport width').toBeDefined();
      expect(width).toBeLessThanOrEqual(480);
      expect(Number(m?.[1])).toBe(width);
      expect(saved.variants.mobile.blueprint?.length).toBeGreaterThan(0);
      // The E2E build holds `debugger`, so emulation yields exactly the phone size.
      expect(width).toBe(390);
    } else {
      expect(text).toMatch(/not captured \(Chrome kept the window too wide\)/);
      await expect(panel.getByRole('button', { name: 'Capture with permission' })).toBeVisible();
    }
    expect(swErrors).toEqual([]);
  });

  test('T5.04 dark capture records variants.dark on dark-mode.html', async ({
    context,
    extensionId,
    swErrors,
  }) => {
    const { panel } = await scanPage(context, extensionId, fixtures, 'dark-mode');
    const captures = panel.getByTestId('captures');
    await expect(captures).toContainText(/Dark mode\s*found · captured from the site/, {
      timeout: 25_000,
    });
    await expect
      .poll(async () => (await storedScans(panel))[0]?.variants?.dark?.measured)
      .toBe(true);
    const [saved] = await storedScans(panel);
    const dark = saved?.variants?.dark;
    const bg = dark?.palette?.find((t) => t.id === dark.roles?.background);
    expect(bg?.hex.toLowerCase()).toBe('#0b0d12');
    // The light side stays the page's own palette.
    const light = saved?.colors.palette.find((t) => t.id === saved.colors.roles.background);
    expect(light?.hex.toLowerCase()).toBe('#ffffff');
    expect(swErrors).toEqual([]);
  });

  test('T5.09 Fidelity: collapsed by default, disabled on the original tab, scores a different build', async ({
    context,
    extensionId,
    swErrors,
  }) => {
    const { panel } = await scanPage(context, extensionId, fixtures, 'landing-basic');
    await goTab(panel, 'Generate');

    // New card behaviour: collapsed by default, nothing to check yet.
    const card = panel.getByTestId('fidelity-card');
    const toggle = card.getByRole('button', { name: /Already built a page from this\?/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.getByTestId('fidelity-pair')).toHaveCount(0);

    // Expanded while the active tab is still the original: "switch tabs", Check disabled.
    await press(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByTestId('fidelity-pair')).toContainText('switch tabs');
    await expect(card.getByRole('button', { name: /^Check/ })).toBeDisabled();

    // Switch to the "build" (landing-serif): Check becomes available.
    const serifUrl = `${fixtures.url}/landing-serif.html`;
    const serif = await openTarget(context, serifUrl);
    await retarget(panel, serifUrl);
    await serif.bringToFront();
    // Playwright's bringToFront does not fire chrome.tabs events in the panel page, so re-open the
    // card (it re-reads the active tab on open) the way a real tab switch would refresh it.
    await press(toggle);
    await press(toggle);
    const check = card.getByRole('button', { name: /^Check: / });
    await expect(check).toBeEnabled({ timeout: 10_000 });
    await expect(panel.getByTestId('fidelity-pair')).not.toContainText('switch tabs');
    await press(check);

    const report = panel.getByTestId('fidelity-report');
    await expect(report).toBeVisible({ timeout: 25_000 });
    const score = Number((await panel.getByTestId('fidelity-score').innerText()).split('\n')[0]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(100);
    // Facet bars and a list of concrete differences.
    for (const facet of ['Colors', 'Type', 'Spacing', 'Shape', 'Layout']) {
      await expect(report).toContainText(new RegExp(facet, 'i'));
    }
    expect(await panel.getByTestId('fidelity-deltas').locator('li').count()).toBeGreaterThan(0);

    await press(panel.getByRole('button', { name: 'Copy fix prompt' }));
    await expect.poll(() => panel.evaluate(() => window.__copied?.length)).toBeGreaterThan(0);
    const fix = (await panel.evaluate(() => window.__copied?.at(-1))) ?? '';
    expect(fix).toContain(`${score}/100`);
    expect(swErrors).toEqual([]);
  });
});
