import { readFileSync } from 'node:fs';
import { startFixtureServer } from '../../../fixtures/serve';
import { expect, test } from './fixtures';
import { goTab, openPanel, openTarget, press, scanPage } from './helpers';

test.describe('Phase 2 generate flows (full extension)', () => {
  let fixtures: Awaited<ReturnType<typeof startFixtureServer>>;
  test.beforeAll(async () => {
    fixtures = await startFixtureServer();
  });
  test.afterAll(async () => {
    await fixtures.close();
  });

  test('T2.13 Download produces a file with the right name and MIME', async ({
    context,
    extensionId,
    swErrors,
  }) => {
    const { panel } = await scanPage(context, extensionId, fixtures, 'landing-basic');
    await goTab(panel, 'Generate');
    await expect(panel.getByTestId('generate-preview')).toBeVisible();

    // Prompt (default): markdown.
    const promptName = (await panel.getByText(/^Saves as /).innerText()).replace('Saves as ', '');
    const [d1] = await Promise.all([
      panel.waitForEvent('download'),
      press(panel.getByRole('button', { name: /^Download$/ })),
    ]);
    expect(d1.suggestedFilename()).toBe(promptName);
    expect(d1.suggestedFilename()).toMatch(/\.md$/);
    expect(readFileSync((await d1.path()) as string, 'utf8')).toContain('#5e6ad2');
    expect((await panel.evaluate(() => window.__blobs))?.at(-1)?.type).toBe('text/markdown');

    // DESIGN.md: its own name, same markdown MIME.
    await press(panel.locator('fieldset[aria-label="Output"] button', { hasText: 'DESIGN.md' }));
    const [d2] = await Promise.all([
      panel.waitForEvent('download'),
      press(panel.getByRole('button', { name: /^Download$/ })),
    ]);
    expect(d2.suggestedFilename()).toBe('DESIGN.md');
    const md = readFileSync((await d2.path()) as string, 'utf8');
    expect(md.length).toBeGreaterThan(500);
    expect((await panel.evaluate(() => window.__blobs))?.at(-1)?.type).toBe('text/markdown');
    expect(swErrors).toEqual([]);
  });

  test('T2.14 the scan-copy command scans the tab and copies the prompt', async ({
    context,
    extensionId,
    swErrors,
  }) => {
    const url = `${fixtures.url}/landing-basic.html`;
    const target = await openTarget(context, url);
    const panel = await openPanel(context, extensionId);
    await target.bringToFront();
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');

    // Test-only message (E2E build): runs exactly the code the Alt+Shift+C command runs.
    const res = await panel.evaluate(
      (u) => chrome.runtime.sendMessage({ type: 'test.scanCopy', url: u }),
      url,
    );
    expect(res).toEqual({ ok: true, data: { ok: true } });

    // The offscreen copy was called with a real prompt...
    const copied = await sw.evaluate(
      () => (globalThis as { __specimenLastCopy?: string }).__specimenLastCopy,
    );
    expect(copied, 'offscreen copy text').toBeTruthy();
    expect(copied).toContain('#5e6ad2');
    expect(copied).not.toContain('Northwind');
    // ...and the success badge is showing (it clears itself after 2 s).
    const failure = await sw.evaluate(
      () => (globalThis as { __specimenLastError?: string }).__specimenLastError,
    );
    expect(failure, 'scan-copy error').toBeUndefined();
    expect(await sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('✓');
    expect(swErrors).toEqual([]);
  });
});
