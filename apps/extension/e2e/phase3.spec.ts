import { startFixtureServer } from '../../../fixtures/serve';
import { expect, test } from './fixtures';
import { goTab, press, scanPage } from './helpers';

/** A fake provider injected through the `globalThis.__specimenProvider` hook. */
function installFakeProvider() {
  const chunks = ['The accent is ', '#5e6ad2, ', 'a calm indigo.'];
  window.__specimenProvider = {
    id: 'fake',
    label: 'Fake AI',
    capabilities: { vision: false, streaming: true, contextTokens: 8000 },
    status: async () => ({ state: 'ready' }),
    async *chat() {
      yield chunks[0];
      await new Promise<void>((r) => setTimeout(r, 1200));
      yield chunks[1];
      yield chunks[2];
    },
  };
}

test.describe('Phase 3 AI flows (full extension)', () => {
  let fixtures: Awaited<ReturnType<typeof startFixtureServer>>;
  test.beforeAll(async () => {
    fixtures = await startFixtureServer();
  });
  test.afterAll(async () => {
    await fixtures.close();
  });

  test('T3.14 with a fake provider injected, Ask returns a streamed answer', async ({
    context,
    extensionId,
    swErrors,
  }) => {
    const { panel } = await scanPage(context, extensionId, fixtures, 'landing-basic', {
      init: installFakeProvider,
    });
    await goTab(panel, 'Ask');
    await expect(panel.getByTestId('ask-view')).toBeVisible();
    await expect(panel.getByTestId('ai-chip')).toHaveText('AI: Fake AI');

    await panel.getByLabel('Question').fill('What is the accent color?');
    await press(panel.getByRole('button', { name: 'Send' }));
    await expect(panel.getByTestId('ask-user')).toHaveText('What is the accent color?');

    // Streaming: the first chunk shows while the rest is still pending...
    const answer = panel.getByTestId('ask-assistant');
    await expect(answer).toHaveText('The accent is ', { timeout: 1000 });
    // ...and the full text arrives afterwards.
    await expect(answer).toHaveText('The accent is #5e6ad2, a calm indigo.');
    expect(swErrors).toEqual([]);
  });
});
