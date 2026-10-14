// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { createMockProvider } from '@specimen/ai/testing';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/entrypoints/sidepanel/App';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { Critique } from '../src/entrypoints/sidepanel/views/Critique';
import { useCritique } from '../src/entrypoints/sidepanel/views/critiqueStore';
import { AiProvider } from '../src/lib/aiContext';
import { SETUP_HINT } from '../src/lib/aiRuntime';
import { flagKey, loadFlag } from '../src/lib/flags';
import { type FakeChrome, installChrome } from './helpers/chrome';

let chrome: FakeChrome;

const SUMMARY = 'Keep:\n- Accent #5e6ad2\nChange:\n- Muted text to 4.5:1';

/** Each persona turn answers "turn N at 16px."; the summary turn answers a keep/change list. */
function mock(opts: Parameters<typeof createMockProvider>[0] = {}) {
  let n = 0;
  return createMockProvider({
    respond: (req) =>
      String(req.messages[0]?.content).includes('Write the final list')
        ? SUMMARY
        : `turn ${++n} at 16px.`,
    ...opts,
  });
}

function inject(p: unknown) {
  (globalThis as { __specimenProvider?: unknown }).__specimenProvider = p;
}

beforeEach(() => {
  chrome = installChrome();
  Element.prototype.scrollIntoView = vi.fn();
  useStore.setState({ scan: sampleScan, status: 'done', activeTab: 'critique', chats: {} });
  useCritique.getState().reset(null);
});

afterEach(() => {
  useCritique.getState().reset(null);
  cleanup();
  vi.unstubAllGlobals();
  delete (globalThis as { __specimenProvider?: unknown }).__specimenProvider;
});

const renderCritique = () =>
  render(
    <AiProvider>
      <Critique />
    </AiProvider>,
  );

describe('Critique panel (component, flag-gated)', () => {
  it('T3.26 flag off: no Critique tab in the side panel', async () => {
    useStore.setState({ activeTab: 'scan' });
    render(<App />);
    await screen.findByRole('tab', { name: 'Ask' });
    expect(screen.queryByRole('tab', { name: 'Critique' })).toBeNull();
  });

  it('T3.26 flag on (=== true): the Critique tab appears, and switching it off removes it', async () => {
    await chrome.storage.local.set({ [flagKey('critique')]: true });
    useStore.setState({ activeTab: 'scan' });
    render(<App />);
    expect(await screen.findByRole('tab', { name: 'Critique' })).toBeTruthy();
    await act(() => chrome.storage.local.set({ [flagKey('critique')]: false }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Critique' })).toBeNull());
  });

  it('T3.26 the flag is on only for the boolean true; a storage error means off', async () => {
    for (const v of ['true', 'false', 1, {}]) {
      await chrome.storage.local.set({ [flagKey('critique')]: v });
      expect(await loadFlag('critique')).toBe(false);
    }
    await chrome.storage.local.set({ [flagKey('critique')]: true });
    expect(await loadFlag('critique')).toBe(true);
    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage down'));
    expect(await loadFlag('critique')).toBe(false);
  });

  it('T3.26 with no provider, shows the same setup hint as Ask', async () => {
    renderCritique();
    const setup = await screen.findByTestId('critique-setup');
    expect(setup.textContent).toContain(SETUP_HINT);
    expect(screen.queryByRole('button', { name: 'Start panel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it('T3.26 with a provider: shows the cap, runs every turn and renders the keep/change list', async () => {
    const p = mock();
    inject(p);
    renderCritique();
    expect((await screen.findByTestId('critique-cap')).textContent).toMatch(
      /^7 calls · ~\d+k tokens to Mock AI$/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start panel' }));
    const summary = await screen.findByTestId('critique-summary');
    expect(summary.textContent).toContain('Accent #5e6ad2');
    expect(summary.textContent).toContain('Muted text to 4.5:1');
    expect(screen.getAllByTestId('critique-persona')).toHaveLength(6);
    expect(p.calls).toHaveLength(7);
  });

  it('T3.26 Stop aborts the run: no further calls and no summary', async () => {
    const p = mock({ delayMs: 20, chunkSize: 2 });
    inject(p);
    renderCritique();
    fireEvent.click(await screen.findByRole('button', { name: 'Start panel' }));
    await waitFor(() => expect(p.calls.length).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(useCritique.getState().phase).toBe('stopped'));
    await new Promise((r) => setTimeout(r, 80));
    expect(p.calls).toHaveLength(2);
    expect(screen.queryByTestId('critique-summary')).toBeNull();
    expect(
      p.calls.some((c) => String(c.messages[0]?.content).includes('Write the final list')),
    ).toBe(false);
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
  });

  it('T3.26 a message typed mid-run is queued and reaches the next reviewer', async () => {
    const p = mock({ delayMs: 15, chunkSize: 3 });
    inject(p);
    renderCritique();
    fireEvent.click(await screen.findByRole('button', { name: 'Start panel' }));
    await waitFor(() => expect(p.calls.length).toBe(1));
    fireEvent.change(screen.getByLabelText('Message to the panel'), {
      target: { value: 'Focus on mobile' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByTestId('critique-queued')).toBeTruthy();
    await waitFor(() => expect(p.calls.length).toBeGreaterThanOrEqual(2));
    expect(String(p.calls[1]?.messages[0]?.content)).toContain('[Human]: Focus on mobile');
    expect((await screen.findByTestId('critique-human')).textContent).toContain('Focus on mobile');
    act(() => useCritique.getState().stop());
  });

  it('T3.26 a scan change mid-run aborts the run (no further calls)', async () => {
    const p = mock({ delayMs: 20, chunkSize: 2 });
    inject(p);
    renderCritique();
    fireEvent.click(await screen.findByRole('button', { name: 'Start panel' }));
    await waitFor(() => expect(p.calls.length).toBe(1));
    act(() => useStore.setState({ scan: { ...sampleScan, id: 'other-scan' } }));
    await new Promise((r) => setTimeout(r, 120));
    expect(p.calls).toHaveLength(1);
    expect(useCritique.getState().phase).toBe('setup');
    expect(useCritique.getState().turns).toHaveLength(0);
  });
});
