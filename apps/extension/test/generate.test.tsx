// @vitest-environment jsdom
import {
  generatePrompt,
  type PromptTarget,
  TARGET_LABELS,
  withoutThemeVariants,
} from '@specimen/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import { useStore } from '../src/entrypoints/sidepanel/store';
import { Generate } from '../src/entrypoints/sidepanel/views/Generate';
import { AiProvider } from '../src/lib/aiContext';
import { installChrome } from './helpers/chrome';

const writeText = vi.fn<(text: string) => Promise<void>>();
/** The preview is one block-span per line; rebuild the text (a blank line renders as one space). */
const preview = () =>
  Array.from(screen.getByTestId('generate-preview').children)
    .map((line) => (line.textContent === ' ' ? '' : line.textContent))
    .join('\n');

beforeEach(() => {
  installChrome();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  useStore.setState({ scan: sampleScan, status: 'done', activeTab: 'generate' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderGenerate = () =>
  render(
    <AiProvider>
      <Generate />
    </AiProvider>,
  );

describe('Generate view (component)', () => {
  it('T2.12 format and target pickers update the preview; Copy writes the exact output', async () => {
    renderGenerate();
    const prompt = (target: PromptTarget) =>
      generatePrompt(withoutThemeVariants(sampleScan), { target }).content;

    // Default: Claude Code prompt.
    await waitFor(() => expect(screen.getByTestId('generate-preview')).toBeTruthy());
    expect(screen.getByText(`Prompt · ${TARGET_LABELS['claude-code']}`)).toBeTruthy();
    const claude = preview();
    expect(claude).toContain('#5e6ad2');

    // Target picker: Cursor has its own wording, so the preview changes.
    fireEvent.click(screen.getByRole('button', { name: TARGET_LABELS.cursor }));
    expect(screen.getByText(`Prompt · ${TARGET_LABELS.cursor}`)).toBeTruthy();
    expect(preview()).not.toBe(claude);
    expect(preview().trim()).toBe(prompt('cursor').trim());

    // Format picker: DESIGN.md replaces the prompt (and hides the target row).
    fireEvent.click(screen.getByRole('button', { name: 'DESIGN.md' }));
    expect(screen.getByText('Saves as DESIGN.md')).toBeTruthy();
    expect(screen.queryByRole('button', { name: TARGET_LABELS.cursor })).toBeNull();
    expect(preview()).toMatch(/^# /);

    // Back to the prompt, then Copy: the clipboard gets exactly what the generator produced.
    fireEvent.click(screen.getByRole('button', { name: 'Prompt' }));
    fireEvent.click(screen.getByRole('button', { name: TARGET_LABELS.v0 }));
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(prompt('v0'));
  });

  it('T2.12 the theme checkbox changes what Copy writes', async () => {
    renderGenerate();
    await waitFor(() => expect(screen.getByTestId('generate-preview')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const without = writeText.mock.calls[0]?.[0] as string;
    fireEvent.click(screen.getByLabelText(/Include .* theme/));
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1]?.[0]).not.toBe(without);
  });
});
