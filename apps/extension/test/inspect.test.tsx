// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { Inspect } from '../src/entrypoints/sidepanel/views/Inspect';
import { AiProvider } from '../src/lib/aiContext';
import { installChrome } from './helpers/chrome';

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
