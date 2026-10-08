import { expect, test } from './fixtures';

test('T0.04 service worker registered with no console errors', async ({
  context,
  extensionId,
  swErrors,
}) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  expect(context.serviceWorkers().length).toBeGreaterThan(0);
  const [sw] = context.serviceWorkers();
  expect(sw?.url()).toContain('background.js');
  // Give the worker a moment to run its startup code.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForTimeout(500);
  expect(swErrors).toEqual([]);
});

test('T0.05 side panel renders the app shell', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole('heading', { name: 'Specimen' })).toBeVisible();
  for (const tab of ['Scan', 'Inspect', 'Generate', 'Ask', 'Library']) {
    await expect(page.getByRole('tab', { name: tab })).toBeVisible();
  }
});

test('T0.06 options page renders', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
