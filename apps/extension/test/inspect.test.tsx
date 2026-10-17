// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { attachInspector, Inspect } from '../src/entrypoints/sidepanel/views/Inspect';
import { AiProvider } from '../src/lib/aiContext';
import type { InspectorHover } from '../src/lib/messaging';
import { type FakeChrome, installChrome } from './helpers/chrome';

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  installChrome();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  useStore.setState({ scan: sampleScan, status: 'done', activeTab: 'inspect' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The real provider, with no AI configured: the Vibe card inside Inspect needs the context.
const renderInspect = () =>
  render(
    <AiProvider>
      <Inspect />
    </AiProvider>,
  );

/** The card (rounded box) that holds a heading; the heading may sit in a header row. */
const cardOf = (title: string) => screen.getByText(title).closest('div.rounded-lg') as HTMLElement;

describe('Inspect view (component)', () => {
  it('T1.29 Palette renders swatches with role labels; clicking copies the hex', () => {
    renderInspect();
    const section = within(cardOf('Palette'));

    for (const [role, id] of Object.entries(sampleScan.colors.roles)) {
      const hex = sampleScan.colors.palette.find((t) => t.id === id)?.hex as string;
      const label = section.getAllByText(role, { exact: true })[0] as HTMLElement;
      const button = label.closest('button') as HTMLElement;
      expect(button, `swatch for ${role}`).not.toBeNull();
      expect(within(button).getByText(hex)).toBeTruthy();
    }

    const accent = section.getByText('accent', { exact: true }).closest('button') as HTMLElement;
    fireEvent.click(accent);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('#5e6ad2');
  });

  it('T1.30 Type scale renders each style with size and weight labels', () => {
    renderInspect();
    for (const s of sampleScan.typography.styles) {
      const label = `${s.role} · ${s.size}px · ${s.weight} · lh ${s.lineHeight}`;
      expect(screen.getByText(label), label).toBeTruthy();
      if (s.sample) expect(screen.getAllByText(s.sample).length).toBeGreaterThan(0);
    }
    for (const f of sampleScan.typography.families) {
      expect(screen.getAllByText(f.name).length).toBeGreaterThan(0);
    }
  });

  it('T1.31 Blueprint lists sections in order with their kinds', () => {
    renderInspect();
    const card = cardOf('Blueprint');
    const items = within(card).getAllByRole('listitem');
    expect(items).toHaveLength(sampleScan.layout.blueprint.length);
    const kinds = items.map((li) => li.querySelector('span.font-medium')?.textContent);
    expect(kinds).toEqual(sampleScan.layout.blueprint.map((s) => s.kind));
  });
});

/** A chrome.events-like hub: add/remove listeners, fire them. */
function hub<A extends unknown[]>() {
  const ls = new Set<(...a: A) => void>();
  return {
    ls,
    addListener: vi.fn((l: (...a: A) => void) => ls.add(l)),
    removeListener: vi.fn((l: (...a: A) => void) => ls.delete(l)),
    fire: (...a: A) => {
      for (const l of [...ls]) l(...a);
    },
  };
}

const TAB = 7;

/**
 * One receiver's end of a Port. In real Chrome a receiver's `disconnect()` closes the channel for
 * the sender and every other receiver (SPC-27 lens A r1 probe; e2e/inspectPorts.spec.ts pins it),
 * so these tests assert Inspect never calls it.
 */
function fakePort(name: string, tabId: number | null = TAB) {
  return {
    name,
    sender: tabId === null ? {} : { tab: { id: tabId } },
    onMessage: hub<[unknown]>(),
    onDisconnect: hub<[]>(),
    disconnect: vi.fn(),
    postMessage: vi.fn(),
  };
}

/** The shared stub has no onConnect: add one, and answer `overlay.set` so Inspect can turn on. */
function withOnConnect(c: FakeChrome) {
  const onConnect = hub<[ReturnType<typeof fakePort>]>();
  Object.assign(c.runtime, { onConnect });
  c.tabs.query.mockResolvedValue([{ id: TAB }] as never);
  c.runtime.sendMessage.mockResolvedValue({ ok: true, data: { ok: true } } as never);
  return { onConnect, sendMessage: c.runtime.sendMessage };
}

/** What the overlay posts (overlay/index.ts): the real payload shape. */
const overlayHover = (tag = 'button'): { type: string } & InspectorHover => ({
  type: 'inspector.hover',
  rect: { x: 10, y: 20, w: 120.4, h: 40 },
  tag,
  styles: {
    color: 'rgb(255, 255, 255)',
    backgroundColor: 'rgb(94, 106, 210)',
    fontFamily: 'Inter, sans-serif',
    fontSize: '14px',
    fontWeight: '500',
    lineHeight: '20px',
    padding: '8px 12px',
    borderRadius: '6px',
  },
  matchedTokens: [{ id: 'accent', hex: '#5e6ad2', prop: 'backgroundColor' }],
});

const inspectorCalls = (sendMessage: FakeChrome['runtime']['sendMessage']) =>
  (sendMessage.mock.calls as unknown as [unknown][])
    .map(([m]) => m as { type?: string; inspector?: boolean; tabId?: number })
    .filter((m) => m.type === 'overlay.set' && m.inspector !== undefined)
    .map((m) => ({ inspector: m.inspector, tabId: m.tabId }));

describe('T1.38 Inspect Port listener (SPC-27)', () => {
  let onConnect: ReturnType<typeof withOnConnect>['onConnect'];
  let sendMessage: FakeChrome['runtime']['sendMessage'];
  beforeEach(() => {
    ({ onConnect, sendMessage } = withOnConnect(installChrome()));
  });

  const inspectButton = () => screen.getByRole('button', { name: 'Inspect' });
  async function turnOn() {
    renderInspect();
    fireEvent.click(inspectButton());
    await waitFor(() => expect(screen.queryByTestId('inspector-card')).not.toBeNull());
    return screen.getByTestId('inspector-card');
  }
  const connect = (name: string, tabId: number | null = TAB) => {
    const port = fakePort(name, tabId);
    act(() => onConnect.fire(port));
    return port;
  };
  const post = (port: ReturnType<typeof fakePort>, m: unknown) => act(() => port.onMessage.fire(m));

  it('T1.38 the overlay Port connecting during overlay.set (the real order) is read', async () => {
    let port: ReturnType<typeof fakePort> | undefined;
    sendMessage.mockImplementation((async (m: { type?: string; inspector?: boolean }) => {
      // The overlay connects while it handles overlay.set, before the panel gets the reply.
      if (m.type === 'overlay.set' && m.inspector) {
        port = fakePort('inspector');
        onConnect.fire(port);
      }
      return { ok: true, data: { ok: true } };
    }) as never);
    const card = await turnOn();
    expect(port).toBeDefined();
    post(port as ReturnType<typeof fakePort>, overlayHover('h1'));
    expect(card.textContent).toContain('h1 · 120×40');
  });

  it('T1.38 a foreign Port (council, llm, unnamed) is ignored: not read, never disconnected', async () => {
    const card = await turnOn();
    for (const name of ['council', 'llm', '']) {
      const port = connect(name);
      expect(port.disconnect).not.toHaveBeenCalled();
      expect(port.onMessage.addListener).not.toHaveBeenCalled();
      expect(port.onDisconnect.addListener).not.toHaveBeenCalled();
      post(port, overlayHover());
    }
    expect(card.textContent).toContain('Hover an element on the page');
  });

  it('T1.38 an inspector Port from another tab is ignored, not disconnected', async () => {
    const card = await turnOn();
    for (const tabId of [99, null]) {
      const other = connect('inspector', tabId);
      expect(other.onMessage.addListener).not.toHaveBeenCalled();
      expect(other.disconnect).not.toHaveBeenCalled();
    }
    post(connect('inspector'), overlayHover('nav'));
    expect(card.textContent).toContain('nav · 120×40');
  });

  it('T1.38 the real overlay payload renders; malformed messages are dropped and the last hover stays', async () => {
    const card = await turnOn();
    const port = connect('inspector');
    post(port, overlayHover());
    expect(card.textContent).toContain('button · 120×40');
    expect(card.textContent).toContain('backgroundColor: rgb(94, 106, 210)');
    expect(card.textContent).toContain('tokens: #5e6ad2');

    const { styles: _s, ...noStyles } = overlayHover('a');
    for (const bad of [
      { type: 'inspector.hover' },
      noStyles,
      { ...overlayHover('b'), matchedTokens: null },
      { ...overlayHover('c'), styles: { color: 4 } },
      { ...overlayHover('d'), type: 'council.start' },
      null,
      'hello',
    ]) {
      expect(() => post(port, bad)).not.toThrow();
    }
    expect(card.textContent).toContain('button · 120×40');
  });

  it('T1.38 a disconnect mid-stream does not throw and later posts are dropped', async () => {
    const card = await turnOn();
    const port = connect('inspector');
    post(port, overlayHover('h1'));
    expect(() => act(() => port.onDisconnect.fire())).not.toThrow();
    expect(port.onMessage.ls.size).toBe(0);
    expect(port.onDisconnect.ls.size).toBe(0);
    post(port, overlayHover('p'));
    expect(card.textContent).toContain('h1 ·');
    expect(card.textContent).not.toContain('p ·');
  });

  it('T1.38 toggling Inspect off removes our listeners, never disconnects, and resets the card', async () => {
    await turnOn();
    const port = connect('inspector');
    post(port, overlayHover('section'));
    fireEvent.click(inspectButton());
    await waitFor(() => expect(screen.queryByTestId('inspector-card')).toBeNull());
    expect(onConnect.ls.size).toBe(0);
    expect(port.onMessage.ls.size).toBe(0);
    expect(port.disconnect).not.toHaveBeenCalled();
    expect(inspectorCalls(sendMessage)).toEqual([
      { inspector: true, tabId: TAB },
      { inspector: false, tabId: TAB },
    ]);

    fireEvent.click(inspectButton());
    await waitFor(() => expect(screen.queryByTestId('inspector-card')).not.toBeNull());
    expect(onConnect.ls.size).toBe(1);
    expect(screen.getByTestId('inspector-card').textContent).toContain(
      'Hover an element on the page',
    );
  });

  it('T1.38 unmounting with Inspect on turns the overlay off and drops late posts', async () => {
    await turnOn();
    const port = connect('inspector');
    cleanup();
    expect(onConnect.ls.size).toBe(0);
    expect(port.onMessage.ls.size).toBe(0);
    expect(port.disconnect).not.toHaveBeenCalled();
    expect(inspectorCalls(sendMessage).at(-1)).toEqual({ inspector: false, tabId: TAB });
    expect(() => post(port, overlayHover())).not.toThrow();
  });

  it('T1.38 a failed overlay.set leaves no listener behind; a double click sends once', async () => {
    renderInspect();
    sendMessage.mockResolvedValueOnce({ ok: false, error: 'Cannot access this page' } as never);
    fireEvent.click(inspectButton());
    await screen.findByText(/Overlay unavailable on this page/);
    expect(onConnect.ls.size).toBe(0);
    expect(screen.queryByTestId('inspector-card')).toBeNull();

    sendMessage.mockClear();
    fireEvent.click(inspectButton());
    fireEvent.click(inspectButton());
    await waitFor(() => expect(screen.queryByTestId('inspector-card')).not.toBeNull());
    expect(inspectorCalls(sendMessage)).toEqual([{ inspector: true, tabId: TAB }]);
    expect(onConnect.ls.size).toBe(1);
  });

  it('T1.38 detach: onConnect removed first, a throwing removeListener does not stop the rest, twice is a no-op', () => {
    const order: string[] = [];
    onConnect.removeListener.mockImplementation((l) => {
      order.push('onConnect');
      return onConnect.ls.delete(l);
    });
    const onHover = vi.fn();
    const detach = attachInspector(onHover, TAB);
    const a = fakePort('inspector');
    const b = fakePort('inspector');
    a.onMessage.removeListener.mockImplementation(() => {
      order.push('a');
      throw new Error('already gone');
    });
    b.onMessage.removeListener.mockImplementation((l) => {
      order.push('b');
      return b.onMessage.ls.delete(l);
    });
    onConnect.fire(a);
    onConnect.fire(b);

    expect(() => detach()).not.toThrow();
    expect(order).toEqual(['onConnect', 'a', 'b']);
    expect(onConnect.ls.size).toBe(0);
    expect(b.onMessage.ls.size).toBe(0);
    a.onMessage.fire(overlayHover());
    b.onMessage.fire(overlayHover());
    expect(onHover).not.toHaveBeenCalled();
    expect(a.disconnect).not.toHaveBeenCalled();
    expect(b.disconnect).not.toHaveBeenCalled();

    detach();
    expect(onConnect.removeListener).toHaveBeenCalledTimes(1);
  });
});
