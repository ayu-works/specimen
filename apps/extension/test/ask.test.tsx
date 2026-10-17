// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { type ChatRequest, ProviderError, TRUNCATED_TEXT } from '@specimen/ai';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STOPPED_TEXT } from '../src/entrypoints/sidepanel/askHistory';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { Ask } from '../src/entrypoints/sidepanel/views/Ask';
import { AiProvider } from '../src/lib/aiContext';
import { SETUP_HINT } from '../src/lib/aiRuntime';
import { loadChat, saveChat, saveScan } from '../src/lib/db';
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

  it('T3.12 an answer cut off at the length limit shows its text and the cut-off line, and is never replayed as history (live or reloaded)', async () => {
    await saveScan(sampleScan, null); // a Library scan: its transcript is persisted
    const calls: ChatRequest[] = [];
    (globalThis as { __specimenProvider?: unknown }).__specimenProvider = {
      ...fakeProvider(),
      async *chat(req: ChatRequest) {
        calls.push(req);
        if (calls.length === 1) {
          yield 'The accent is ';
          throw new ProviderError('other', TRUNCATED_TEXT);
        }
        yield 'Fine.';
      },
    };
    const ask = async (q: string, n: number) => {
      fireEvent.change(await screen.findByLabelText('Question'), { target: { value: q } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(screen.getAllByTestId('ask-assistant')).toHaveLength(n));
      await waitFor(() =>
        expect(screen.getAllByTestId('ask-assistant')[n - 1]?.textContent).not.toBe('…'),
      );
    };
    const history = (req: ChatRequest | undefined) => JSON.stringify(req?.messages ?? []);

    renderAsk();
    await ask('What is the accent?', 1);
    const cut = screen.getAllByTestId('ask-assistant')[0] as HTMLElement;
    await waitFor(() => expect(cut.textContent).toContain(TRUNCATED_TEXT));
    expect(cut.textContent).toContain('The accent is');

    await ask('And the font?', 2);
    expect(calls).toHaveLength(2);
    expect(history(calls[1])).not.toContain('The accent is');

    // Saved with its error; after a panel reload it is still shown cut off and still kept out.
    await waitFor(async () =>
      expect((await loadChat(sampleScan.id))[1]).toMatchObject({
        role: 'assistant',
        content: 'The accent is ',
        error: TRUNCATED_TEXT,
      }),
    );
    cleanup();
    useStore.setState({ chats: {} });
    renderAsk();
    await waitFor(() => expect(screen.getAllByTestId('ask-assistant')).toHaveLength(2));
    expect(screen.getAllByTestId('ask-assistant')[0]?.textContent).toContain(TRUNCATED_TEXT);
    await ask('And spacing?', 3);
    expect(history(calls[2])).not.toContain('The accent is');
    expect(history(calls[2])).toContain('Fine.');
  });

  /** Streams `first` then waits for the abort; it ends with `abortAs` (a ProviderError or a DOMException). */
  function stoppableProvider(first: string[], abortAs: 'provider' | 'dom') {
    const calls: ChatRequest[] = [];
    const provider = {
      ...fakeProvider(),
      async *chat(req: ChatRequest, signal?: AbortSignal) {
        calls.push(req);
        if (calls.length > 1) {
          yield 'Fine.';
          return;
        }
        for (const t of first) yield t;
        await new Promise<void>((r) =>
          signal?.addEventListener('abort', () => r(), { once: true }),
        );
        throw abortAs === 'provider'
          ? new ProviderError('aborted', 'Stopped')
          : new DOMException('The operation was aborted.', 'AbortError');
      },
    };
    (globalThis as { __specimenProvider?: unknown }).__specimenProvider = provider;
    return calls;
  }
  const send = async (q: string) => {
    fireEvent.change(await screen.findByLabelText('Question'), { target: { value: q } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  };
  const history = (req: ChatRequest | undefined) => JSON.stringify(req?.messages ?? []);

  it('T3.12 a stopped answer keeps its text, is marked Stopped, and is never replayed as history (live or reloaded)', async () => {
    await saveScan(sampleScan, null); // a Library scan: its transcript is persisted
    await saveChat(sampleScan.id, []); // the cut-off test above saved one for the same scan
    const calls = stoppableProvider(['The accent is '], 'provider');
    renderAsk();
    await send('What is the accent?');
    await waitFor(() =>
      expect(screen.getByTestId('ask-assistant').textContent).toBe('The accent is '),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(screen.getByTestId('ask-assistant').textContent).toContain(STOPPED_TEXT),
    );
    expect(screen.getByTestId('ask-assistant').textContent).toContain('The accent is');

    await send('And the font?');
    await waitFor(() =>
      expect(screen.getAllByTestId('ask-assistant')[1]?.textContent).toBe('Fine.'),
    );
    // Neither the half answer nor its question is replayed: no two user turns in a row.
    expect(history(calls[1])).not.toContain('The accent is');
    expect(calls[1]?.messages.map((m) => m.role)).toEqual(['user']);

    await waitFor(async () =>
      expect((await loadChat(sampleScan.id))[1]).toMatchObject({
        role: 'assistant',
        content: 'The accent is ',
        error: STOPPED_TEXT,
      }),
    );
    cleanup();
    useStore.setState({ chats: {} });
    renderAsk();
    await waitFor(() => expect(screen.getAllByTestId('ask-assistant')).toHaveLength(2));
    expect(screen.getAllByTestId('ask-assistant')[0]?.textContent).toContain(STOPPED_TEXT);
    await send('And spacing?');
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(history(calls[2])).not.toContain('The accent is');
    expect(calls[2]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(history(calls[2])).toContain('Fine.');
  });

  it('T3.12 a Stop before any text shows Stopped, not an endless thinking bubble (abort as a DOMException too)', async () => {
    await saveChat(sampleScan.id, []);
    const calls = stoppableProvider([], 'dom');
    renderAsk();
    await send('What is the accent?');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(screen.getByTestId('ask-assistant').textContent).toBe(STOPPED_TEXT));
    expect(useStore.getState().chats[sampleScan.id]?.[1]).toMatchObject({
      content: '',
      error: STOPPED_TEXT,
    });
    await send('And the font?');
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.messages.map((m) => m.role)).toEqual(['user']);
  });
});
