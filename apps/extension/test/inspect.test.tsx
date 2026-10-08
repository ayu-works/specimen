// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { Inspect } from '../src/entrypoints/sidepanel/views/Inspect';

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  useStore.setState({ scan: sampleScan, status: 'done', activeTab: 'inspect' });
});

afterEach(cleanup);

describe('Inspect view (component)', () => {
  it('T1.29 Palette renders swatches with role labels; clicking copies the hex', () => {
    render(<Inspect />);
    const section = within(screen.getByText('Palette').parentElement as HTMLElement);

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
    render(<Inspect />);
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
    render(<Inspect />);
    const card = screen.getByText('Blueprint').parentElement as HTMLElement;
    const items = within(card).getAllByRole('listitem');
    expect(items).toHaveLength(sampleScan.layout.blueprint.length);
    const kinds = items.map((li) => li.querySelector('span.font-medium')?.textContent);
    expect(kinds).toEqual(sampleScan.layout.blueprint.map((s) => s.kind));
  });
});
