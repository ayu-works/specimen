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
});
