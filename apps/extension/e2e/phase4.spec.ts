import type { Page } from '@playwright/test';
import { startFixtureServer } from '../../../fixtures/serve';
import { expect, test } from './fixtures';
import { goTab, openTarget, press, retarget, scanPage } from './helpers';

test.describe('Phase 4 library flows (full extension)', () => {
  let fixtures: Awaited<ReturnType<typeof startFixtureServer>>;
  test.beforeAll(async () => {
    fixtures = await startFixtureServer();
  });
  test.afterAll(async () => {
    await fixtures.close();
  });

  test('T4.08 a scan appears in the Library after a panel reload', async ({
    context,
    extensionId,
    swErrors,
  }) => {
    const { panel } = await scanPage(context, extensionId, fixtures, 'landing-basic');
    await panel.reload();
    // The reload dropped the in-memory scan; only the Library (IndexedDB) remembers it.
    await expect(panel.getByTestId('scan-result')).toHaveCount(0);
    await goTab(panel, 'Library');
    const cards = panel.getByTestId('library-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Northwind');
    await expect(cards.first()).toContainText('127.0.0.1');
    expect(swErrors).toEqual([]);
  });

  test('T4.09 composing two scans makes Generate show the mixed prompt', async ({
    context,
    extensionId,
    swErrors,
  }) => {
    const { panel } = await scanPage(context, extensionId, fixtures, 'landing-basic');
    // Second scan: point the panel's active tab at landing-serif and scan again.
    const serifUrl = `${fixtures.url}/landing-serif.html`;
    const serif = await openTarget(context, serifUrl);
    await retarget(panel, serifUrl);
    await serif.bringToFront();
    await press(panel.getByRole('button', { name: 'Re-scan' }));
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const open = indexedDB.open('specimen');
              open.onsuccess = () => {
                const count = open.result.transaction('scans').objectStore('scans').count();
                count.onsuccess = () => {
                  resolve(count.result);
                  open.result.close();
                };
              };
            }),
        ),
      )
      .toBe(2);

    await goTab(panel, 'Library');
    await expect(panel.getByTestId('library-card')).toHaveCount(2);
    await press(panel.getByRole('button', { name: /Compose/ }));
    await expect(panel.getByTestId('compose-view')).toBeVisible();

    const option = (re: RegExp) =>
      panel
        .locator('#compose-base option')
        .filter({ hasText: re })
        .first()
        .getAttribute('value') as Promise<string>;
    await panel.locator('#compose-base').selectOption(await option(/Northwind/));
    await panel.locator('#compose-colors').selectOption(await option(/Fernhill/));
    await press(panel.getByRole('button', { name: 'Use this design' }));

    // Generate shows the mixed design: colors from Fernhill, nothing of Northwind's accent.
    const preview = panel.getByTestId('generate-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('#9a3412');
    expect(await preview.innerText()).not.toContain('#5e6ad2');
    // Layout stays Northwind's (1200px container), unlike Fernhill's 1080px.
    await expect(preview).toContainText('1200');
    expect(swErrors).toEqual([]);
  });

  test('T4.13 every ⋯ menu item is visible and the card Delete works (SPC-39)', async ({
    context,
    extensionId,
    swErrors,
  }) => {
    const { panel } = await scanPage(context, extensionId, fixtures, 'landing-basic');
    // Three scans make two rows: a left-column card with a row under it, and a last row.
    for (const [i, name] of ['landing-serif', 'pill'].entries()) {
      const url = `${fixtures.url}/${name}.html`;
      const page = await openTarget(context, url);
      await retarget(panel, url);
      await page.bringToFront();
      await press(panel.getByRole('button', { name: 'Re-scan' }));
      await expect.poll(() => storedScans(panel)).toBe(i + 2);
    }
    // The narrowest side panel: a card is at its smallest here.
    await panel.setViewportSize({ width: 320, height: 900 });
    await goTab(panel, 'Library');
    const cards = panel.getByTestId('library-card');
    await expect(cards).toHaveCount(3);

    // Card 0 is the left column of the first row; card 2 is the left column of the last row;
    // card 1 is the right column.
    for (const index of [0, 1, 2]) {
      const card = cards.nth(index);
      await card.getByRole('button', { name: 'More actions' }).click();
      const items = panel.getByRole('menuitem');
      await expect(items.last()).toHaveText('Delete');
      for (const item of await items.all()) {
        await item.scrollIntoViewIfNeeded();
        const box = await item.boundingBox();
        expect(box).not.toBeNull();
        if (!box) continue;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(320);
        // Hit-testing respects overflow clipping and stacking: a clipped or covered item fails.
        const hit = await item.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return at !== null && el.contains(at);
        });
        expect(hit, `${await item.innerText()} on card ${index}`).toBe(true);
      }
      await panel.keyboard.press('Escape');
      await expect(panel.getByRole('menu')).toHaveCount(0);
    }

    // The visible Delete: confirm removes the card.
    const last = cards.nth(2);
    const title = (await last.locator('.truncate').first().innerText()).trim();
    panel.once('dialog', (d) => {
      expect(d.message()).toBe(`Delete "${title}" from your Library?`);
      void d.accept();
    });
    await last.getByRole('button', { name: `Delete ${title}` }).click();
    await expect(cards).toHaveCount(2);
    await expect.poll(() => storedScans(panel)).toBe(2);
    expect(swErrors).toEqual([]);
  });
});

/** How many scans the panel's IndexedDB holds. */
function storedScans(panel: Page) {
  return panel.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('specimen');
        open.onsuccess = () => {
          const count = open.result.transaction('scans').objectStore('scans').count();
          count.onsuccess = () => {
            resolve(count.result);
            open.result.close();
          };
        };
      }),
  );
}
