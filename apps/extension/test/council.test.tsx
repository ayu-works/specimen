// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { CRITIQUE_TRUNCATED } from '@specimen/ai';
import { createMockProvider } from '@specimen/ai/testing';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCouncilHost } from '../src/entrypoints/offscreen/councilHost';
import App from '../src/entrypoints/sidepanel/App';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { SETUP_HINT } from '../src/lib/aiRuntime';
import { _resetCouncil, councilIo, SETTINGS_CHANGED } from '../src/lib/council';
import { _resetCouncilDb, getRun, latestRun, putRun } from '../src/lib/councilDb';
import { COUNCIL_REJECT, type CouncilRecord, SEEN_KEY } from '../src/lib/councilProtocol';
import { flagKey } from '../src/lib/flags';
import { createPortPair } from '../src/lib/localPort';
import { type FakeChrome, installChrome } from './helpers/chrome';

let chrome: FakeChrome;
const io = { ...councilIo };
const VERDICT =
  'Verdict: Calm and readable.\nWorks:\n- Accent #5e6ad2 on white\nChange:\n- Muted text #8a8f98 to 4.5:1\nDisagreed:\n- Radius scale';

function mock(opts: Parameters<typeof createMockProvider>[0] = {}) {
  let n = 0;
  return createMockProvider({
    respond: (req) =>
      String(req.messages[0]?.content).includes('Write the verdict')
        ? VERDICT
        : `turn ${++n} at 16px.`,
    ...opts,
  });
}

type RuntimeListener = (msg: unknown) => unknown;
let runtimeListeners: Set<RuntimeListener>;
const hostEnds: { disconnect(): void }[] = [];

/** A real council host on the far end of an in-memory Port pair. Its SW notices reach the panel. */
function wireHost(provider = mock(), extra: Partial<Parameters<typeof createCouncilHost>[0]> = {}) {
  const host = createCouncilHost({
    makeProvider: async () => provider,
    notify: (m) => {
      for (const l of runtimeListeners) l(m);
    },
    engine: { tokensPerMinute: 0, retryDelaysMs: [5] },
    ...extra,
  });
  councilIo.connect = () => {
    const [panel, hostEnd] = createPortPair('council');
    host.attach(hostEnd as never);
    hostEnds.push(hostEnd);
    return panel as never;
  };
  councilIo.hasOffscreen = async () => true;
  councilIo.ensure = async () => {};
  return { host, provider };
}

function inject(p: unknown) {
  (globalThis as { __specimenProvider?: unknown }).__specimenProvider = p;
}

const headerMood = () => screen.getAllByTestId('mascot')[0]?.getAttribute('data-mood');

async function flagOn() {
  await chrome.storage.local.set({ [flagKey('critique')]: true });
}

function record(over: Partial<CouncilRecord> = {}): CouncilRecord {
  return {
    v: 1,
    runId: 'old',
    scanId: sampleScan.id,
    scanHost: 'example.com',
    status: 'done',
    plan: { personas: ['brand', 'a11y'], rounds: 1, totalTurns: 3, providerLabel: 'Mock AI' },
    context: 'A clinic app.',
    turns: [{ kind: 'persona', persona: 'brand', content: 'turn 1 at 16px.', status: 'done' }],
    verdict: { verdict: 'Fine.', works: ['16px body'], change: ['Muted text'], disagreed: [] },
    startedAt: 1,
    updatedAt: 1,
    ...over,
  };
}

beforeEach(async () => {
  chrome = installChrome();
  runtimeListeners = new Set();
  hostEnds.length = 0;
  (chrome.runtime as unknown as { onMessage: unknown }).onMessage = {
    addListener: (l: RuntimeListener) => runtimeListeners.add(l),
    removeListener: (l: RuntimeListener) => runtimeListeners.delete(l),
  };
  Element.prototype.scrollIntoView = vi.fn();
  useStore.setState({
    scan: sampleScan,
    status: 'done',
    activeTab: 'ask',
    askMode: 'quick',
    chats: {},
  });
  _resetCouncil();
  await _resetCouncilDb();
});

afterEach(async () => {
  cleanup();
  _resetCouncil();
  Object.assign(councilIo, io);
  vi.unstubAllGlobals();
  delete (globalThis as { __specimenProvider?: unknown }).__specimenProvider;
  await _resetCouncilDb();
});

describe('Ask + council (component)', () => {
  it('T3.33 flag off: Ask is unchanged, no mode switch, no Critique tab', async () => {
    inject(mock());
    render(<App />);
    await screen.findByTestId('ask-view');
    expect(screen.queryByRole('radiogroup', { name: 'Ask mode' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Critique' })).toBeNull();
    expect(screen.queryByText('Ask the council')).toBeNull();
  });

  it('T3.33 the flag is off unless it is exactly true, and off on a storage error', async () => {
    inject(mock());
    await chrome.storage.local.set({ [flagKey('critique')]: 'true' });
    const r = render(<App />);
    await screen.findByTestId('ask-view');
    expect(screen.queryByRole('radiogroup', { name: 'Ask mode' })).toBeNull();
    r.unmount();
    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage broken'));
    render(<App />);
    await screen.findByTestId('ask-view');
    expect(screen.queryByRole('radiogroup', { name: 'Ask mode' })).toBeNull();
  });

  it('T3.33 flag on: the switch appears; no provider shows the setup hint', async () => {
    await flagOn();
    render(<App />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Ask the council' }));
    const hint = await screen.findByTestId('council-setup-hint');
    expect(hint.textContent).toContain(SETUP_HINT);
  });

  it('T3.33 a full run: goal box, Start, thinking, verdict report with a closed "Show discussion"', async () => {
    const { provider } = wireHost(mock({ delayMs: 5, chunkSize: 4 }));
    inject(provider);
    await flagOn();
    render(<App />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Ask the council' }));
    const goal = (await screen.findByRole('textbox', { name: 'Your goal' })) as HTMLTextAreaElement;
    expect(goal.maxLength).toBe(1000);
    fireEvent.change(goal, { target: { value: 'A clinic booking app for older patients.' } });
    expect(screen.getByTestId('council-privacy').textContent).toContain('plus your goal text');
    expect(screen.getByTestId('council-privacy').textContent).toContain(
      'continues with the panel closed',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask the council' }));

    await screen.findByTestId('council-running');
    expect(headerMood()).toBe('thinking');
    expect(screen.getByTestId('council-progress').textContent).toMatch(/Turn \d of 7 · Mock AI/);
    await waitFor(() => expect(provider.calls.length).toBeGreaterThan(0));
    expect(String(provider.calls[0]?.messages[0]?.content)).toContain(
      'A clinic booking app for older patients.',
    );

    const report = await screen.findByTestId('council-report', {}, { timeout: 10_000 });
    expect(screen.getByTestId('council-verdict').textContent).toBe('Calm and readable.');
    expect(report.textContent).toContain('What works');
    expect(report.textContent).toContain('What to change');
    expect(report.textContent).toContain('Where the reviewers disagreed');
    // Verdict only: no generated prompt anywhere.
    expect(report.textContent?.toLowerCase()).not.toContain('prompt');
    expect(screen.queryByRole('button', { name: /prompt/i })).toBeNull();
    const details = screen.getByTestId('council-discussion') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText('Show discussion'));
    expect(details.open).toBe(true);
    expect(screen.getAllByTestId('council-turn-persona').length).toBe(6);
    // Shown → seen: the mascot calms down and the SW is told (badge clears).
    const runId = (await latestRun())?.runId;
    await waitFor(() => expect(chrome.storage.local.data.get(SEEN_KEY)).toBe(runId));
    expect(headerMood()).toBe('idle');
  });

  it('T3.33 panel elsewhere: the mascot turns happy when done, and a click opens the verdict', async () => {
    const { provider } = wireHost(mock({ delayMs: 2, chunkSize: 6 }));
    inject(provider);
    await flagOn();
    render(<App />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Ask the council' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the council' }));
    await screen.findByTestId('council-running');
    act(() => useStore.getState().setTab('scan'));
    await waitFor(() => expect(headerMood()).toBe('happy'), { timeout: 10_000 });
    expect(chrome.storage.local.data.get(SEEN_KEY)).toBeUndefined();
    fireEvent.click(screen.getByTestId('mascot-council'));
    await screen.findByTestId('council-report');
    expect(useStore.getState().activeTab).toBe('ask');
    await waitFor(() => expect(headerMood()).toBe('idle'));
  });

  it('T3.33 Stop from the panel ends the run with no further calls', async () => {
    const { provider } = wireHost(mock({ delayMs: 20, chunkSize: 2 }));
    inject(provider);
    await flagOn();
    useStore.setState({ askMode: 'council' });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the council' }));
    await waitFor(() => expect(provider.calls.length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await screen.findByTestId('council-stopped');
    const n = provider.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(provider.calls.length).toBe(n);
    expect(n).toBeLessThan(7);
  });

  it('T3.33 a verdict for another scan shows the "earlier scan" note', async () => {
    await putRun(record({ scanId: 'another-scan', scanHost: 'other.example' }));
    inject(mock());
    await flagOn();
    useStore.setState({ askMode: 'council' });
    render(<App />);
    expect((await screen.findByTestId('council-other-scan')).textContent).toContain(
      'other.example',
    );
    expect(screen.getByRole('button', { name: 'Ask about the current scan' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask about the current scan' }));
    expect(await screen.findByRole('textbox', { name: 'Your goal' })).toBeTruthy();
  });

  it('T3.33 a start the host rejects shows its fixed text and stays on the setup card', async () => {
    const host = createCouncilHost({ makeProvider: async () => null, notify: () => {} });
    councilIo.connect = () => {
      const [panel, hostEnd] = createPortPair('council');
      host.attach(hostEnd as never);
      return panel as never;
    };
    councilIo.ensure = async () => {};
    inject(mock());
    await flagOn();
    useStore.setState({ askMode: 'council' });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the council' }));
    expect((await screen.findByTestId('council-rejected')).textContent).toBe(
      COUNCIL_REJECT.provider,
    );
    expect(screen.getByRole('button', { name: 'Ask the council' })).toBeTruthy();
    expect(await latestRun()).toBeNull();
  });

  it('T3.33 a stored error shows its fixed text', async () => {
    await putRun(
      record({
        status: 'error',
        verdict: null,
        error: 'The provider rejected the API key. Check it in Settings.',
      }),
    );
    inject(mock());
    await flagOn();
    useStore.setState({ askMode: 'council' });
    render(<App />);
    expect((await screen.findByTestId('council-error')).textContent).toContain(
      'rejected the API key',
    );
    // The header mascot was sad until the panel showed it.
    await waitFor(() => expect(headerMood()).toBe('idle'));
  });

  it('T3.33 a cut-off turn shows its partial text above the error, and no verdict report', async () => {
    await putRun(
      record({
        status: 'error',
        verdict: null,
        error: CRITIQUE_TRUNCATED,
        turns: [
          { kind: 'persona', persona: 'brand', content: 'turn 1 at 16px.', status: 'done' },
          {
            kind: 'summary',
            content: 'Verdict: Solid.\nWorks:\n- 16px rhythm\nChange:\n- Raise',
            status: 'error',
            error: CRITIQUE_TRUNCATED,
          },
        ],
      }),
    );
    inject(mock());
    await flagOn();
    useStore.setState({ askMode: 'council' });
    render(<App />);
    expect((await screen.findByTestId('council-error')).textContent).toContain(CRITIQUE_TRUNCATED);
    const summary = screen.getByTestId('council-turn-summary');
    expect(summary.textContent).toContain('Verdict: Solid.');
    expect(summary.textContent).toContain(CRITIQUE_TRUNCATED);
    expect(screen.queryByTestId('council-report')).toBeNull();
    expect(screen.queryByTestId('council-verdict')).toBeNull();
  });

  it('T3.32 reattach: no offscreen document → interrupted', async () => {
    await putRun(record({ runId: 'live', status: 'running', verdict: null }));
    councilIo.hasOffscreen = async () => false;
    inject(mock());
    await flagOn();
    useStore.setState({ askMode: 'council' });
    render(<App />);
    await screen.findByTestId('council-interrupted');
    expect((await latestRun())?.status).toBe('interrupted');
  });

  it('T3.32 reattach: a host that does not know the run → interrupted', async () => {
    await putRun(record({ runId: 'live', status: 'running', verdict: null }));
    wireHost();
    inject(mock());
    await flagOn();
    useStore.setState({ askMode: 'council' });
    render(<App />);
    await screen.findByTestId('council-interrupted');
    expect((await latestRun())?.status).toBe('interrupted');
  });

  it('T3.32 reattach: no answer within the timeout → interrupted', async () => {
    await putRun(record({ runId: 'live', status: 'running', verdict: null }));
    councilIo.hasOffscreen = async () => true;
    councilIo.attachTimeoutMs = 50;
    councilIo.connect = () => createPortPair('council')[0] as never;
    inject(mock());
    await flagOn();
    useStore.setState({ askMode: 'council' });
    render(<App />);
    await screen.findByTestId('council-interrupted');
  });

  it('T3.32 reattach: a live run is picked up again after the panel reopens', async () => {
    const { provider } = wireHost(mock({ delayMs: 40, chunkSize: 2 }));
    inject(provider);
    await flagOn();
    useStore.setState({ askMode: 'council' });
    const first = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the council' }));
    await waitFor(() => expect(provider.calls.length).toBeGreaterThan(0));
    // Close the panel: the page goes away, the host keeps running.
    first.unmount();
    _resetCouncil();
    render(<App />);
    await screen.findByTestId('council-running');
    await screen.findByTestId('council-report', {}, { timeout: 20_000 });
    expect(provider.calls).toHaveLength(7);
  });

  it('T3.32 reopen with nothing stored (writes failing): the panel still finds the live run', async () => {
    const { provider } = wireHost(mock({ delayMs: 40, chunkSize: 2 }), {
      put: async () => {
        throw new Error('quota');
      },
    });
    inject(provider);
    await flagOn();
    useStore.setState({ askMode: 'council' });
    const first = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the council' }));
    await waitFor(() => expect(provider.calls.length).toBeGreaterThan(0));
    first.unmount();
    _resetCouncil();
    expect(await latestRun()).toBeNull();
    render(<App />);
    await screen.findByTestId('council-running');
    await screen.findByTestId('council-report', {}, { timeout: 20_000 });
  });

  it('T3.32 the host dies mid-run with the panel attached (after turns were stored) → interrupted', async () => {
    let dead = false;
    const { provider } = wireHost(mock({ delayMs: 20, chunkSize: 2 }), {
      put: (rec) => (dead ? Promise.resolve() : putRun(rec)),
    });
    inject(provider);
    await flagOn();
    useStore.setState({ askMode: 'council' });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the council' }));
    await screen.findByTestId('council-running');
    await waitFor(async () => expect(await latestRun()).not.toBeNull());
    const first = (await latestRun()) as CouncilRecord;
    // Two turns stored: the stored updatedAt has moved past the panel's copy.
    await waitFor(
      async () =>
        expect(
          (await getRun(first.runId))?.turns.filter((t) => t.status === 'done').length,
        ).toBeGreaterThanOrEqual(2),
      { timeout: 10_000 },
    );
    expect((await getRun(first.runId))?.updatedAt).not.toBe(first.updatedAt);
    // The offscreen document crashes: no more writes, the Port drops.
    dead = true;
    for (const e of hostEnds) e.disconnect();
    await screen.findByTestId('council-interrupted');
    expect((await getRun(first.runId))?.status).toBe('interrupted');
    expect(screen.getByRole('button', { name: 'Start again' })).toBeTruthy();
    await waitFor(() => expect(headerMood()).toBe('idle'));
  });

  it('T3.33 a run started from another window shows up here (running, then done)', async () => {
    const provider = mock({ delayMs: 10, chunkSize: 3 });
    const { host } = wireHost(provider);
    inject(provider);
    await flagOn();
    // This panel opened before any offscreen document existed: no Port yet.
    councilIo.hasOffscreen = async () => false;
    useStore.setState({ askMode: 'council' });
    render(<App />);
    await screen.findByTestId('council-setup');
    // The other window's panel starts a run on the same host.
    const [other, hostEnd] = createPortPair('council');
    host.attach(hostEnd as never);
    other.postMessage({
      type: 'start',
      v: 1,
      runId: 'elsewhere',
      scan: sampleScan,
      provider: { kind: 'chrome' },
      personas: ['brand', 'a11y'],
      rounds: 1,
      context: '',
      resolvedAt: Date.now(),
    });
    await screen.findByTestId('council-running');
    await screen.findByTestId('council-report', {}, { timeout: 10_000 });
  });

  it('T3.33 settings changed while the host was being created: nothing is sent', async () => {
    for (const change of ['flag', 'provider'] as const) {
      const { provider } = wireHost();
      inject(provider);
      await flagOn();
      useStore.setState({ askMode: 'council' });
      councilIo.ensure = async () => {
        if (change === 'flag') await chrome.storage.local.set({ [flagKey('critique')]: false });
        else inject(mock({ id: 'other-provider' }));
      };
      const r = render(<App />);
      if (change === 'flag') {
        // The click happens with the flag on; it goes off during ensure.
        fireEvent.click(await screen.findByRole('button', { name: 'Ask the council' }));
        await waitFor(async () => expect(await latestRun()).toBeNull());
        expect(provider.calls).toHaveLength(0);
      } else {
        fireEvent.click(await screen.findByRole('button', { name: 'Ask the council' }));
        expect((await screen.findByTestId('council-rejected')).textContent).toBe(SETTINGS_CHANGED);
        expect(provider.calls).toHaveLength(0);
        expect(await latestRun()).toBeNull();
      }
      r.unmount();
      _resetCouncil();
      Object.assign(councilIo, io);
    }
  });

  it('T3.32 the final write failed twice: reopening still shows the verdict and stores it', async () => {
    const { provider } = wireHost(mock({ delayMs: 2, chunkSize: 8 }), {
      put: (rec) => (rec.status === 'running' ? putRun(rec) : Promise.reject(new Error('quota'))),
    });
    inject(provider);
    await flagOn();
    useStore.setState({ askMode: 'council' });
    const first = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the council' }));
    await screen.findByTestId('council-report', {}, { timeout: 10_000 });
    expect((await latestRun())?.status).toBe('running');
    first.unmount();
    _resetCouncil();
    render(<App />);
    await screen.findByTestId('council-report');
    await waitFor(async () => expect((await latestRun())?.status).toBe('done'));
  });

  it('T3.32 a slow host that answers after the attach timeout still wins', async () => {
    const rec = record({ runId: 'live', status: 'running', verdict: null });
    await putRun(rec);
    councilIo.hasOffscreen = async () => true;
    councilIo.attachTimeoutMs = 30;
    councilIo.connect = () => {
      const [panel, hostEnd] = createPortPair('council');
      hostEnd.onMessage.addListener(((m: { type: string }) => {
        if (m.type === 'attach')
          setTimeout(
            () => hostEnd.postMessage({ type: 'snapshot', record: { ...rec, updatedAt: 9 } }),
            150,
          );
      }) as never);
      return panel as never;
    };
    inject(mock());
    await flagOn();
    useStore.setState({ askMode: 'council' });
    render(<App />);
    await screen.findByTestId('council-interrupted');
    await screen.findByTestId('council-running');
  });
});
