// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { Ask } from '../src/entrypoints/sidepanel/views/Ask';
import { AiProvider } from '../src/lib/aiContext';
import { SETUP_HINT } from '../src/lib/aiRuntime';
import { type FakeChrome, fakeProvider, installChrome } from './helpers/chrome';

let chrome: FakeChrome;

beforeEach(() => {
  chrome = installChrome();
  Element.prototype.scrollIntoView = vi.fn();
  useStore.setState({ scan: sampleScan, status: 'done', activeTab: 'ask', chats: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (globalThis as { __specimenProvider?: unknown }).__specimenProvider;
});

const renderAsk = () =>
  render(
    <AiProvider>
      <Ask />
    </AiProvider>,
  );

describe('Ask view (component)', () => {
  it('T3.12 with no provider, Ask shows the setup hint and offers Settings instead of a chat box', async () => {
    renderAsk();
    const setup = await screen.findByTestId('ask-setup');
    expect(setup.textContent).toContain(SETUP_HINT);
    expect(screen.queryByLabelText('Question')).toBeNull();
    expect(screen.queryByTestId('ask-view')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it('T3.12 with a provider, Ask is enabled and streams the answer', async () => {
    (globalThis as { __specimenProvider?: unknown }).__specimenProvider = fakeProvider([
      'The accent ',
      'is #5e6ad2.',
    ]);
    renderAsk();
    const input = (await screen.findByLabelText('Question')) as HTMLInputElement;
    expect(screen.queryByTestId('ask-setup')).toBeNull();
    // Send stays disabled until there is a question.
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(input, { target: { value: 'What is the accent?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect((await screen.findByTestId('ask-user')).textContent).toBe('What is the accent?');
    await waitFor(() =>
      expect(screen.getByTestId('ask-assistant').textContent).toBe('The accent is #5e6ad2.'),
    );
    // The stream finished: the input is usable again and the chat is kept in the store.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy());
    expect(useStore.getState().chats[sampleScan.id]?.map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
  });
});
