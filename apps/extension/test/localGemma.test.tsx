// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalGemma } from '../src/entrypoints/options/LocalGemma';
import { DEFAULT_AI_SETTINGS } from '../src/lib/aiSettings';
import { installChrome } from './helpers/chrome';
import { type GpuMode, stubGpu } from './helpers/gpu';

/** The offscreen host, as the card's `WebLLMClient` sees it: no real model or Port. */
const client = vi.hoisted(() => ({
  status: vi.fn(),
  load: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@specimen/ai', async (orig) => ({
  ...(await orig<typeof import('@specimen/ai')>()),
  WebLLMClient: class {
    status = client.status;
    load = client.load;
    remove = client.remove;
  },
}));
vi.mock('@/lib/messaging', () => ({ send: vi.fn(async () => undefined) }));

beforeEach(async () => {
  installChrome();
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => ({}) },
  });
  client.status.mockResolvedValue({ loading: false, gpu: true, cached: false });
  client.load.mockReset();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'gpu');
  vi.unstubAllGlobals();
});

const status = () => screen.getByTestId('gemma-status').textContent;

describe('Options: Local Gemma card', () => {
  it('T3.11 a load that fails (worker crash) shows the error and offers a retry that works', async () => {
    const { ProviderError } = await import('@specimen/ai');
    client.load.mockRejectedValueOnce(
      new ProviderError('other', 'The local model stopped unexpectedly. Try again.'),
    );
    client.load.mockResolvedValueOnce(undefined);
    render(<LocalGemma settings={DEFAULT_AI_SETTINGS} onChange={() => {}} />);
    const button = (await screen.findByRole('button', {
      name: 'Download & load',
    })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));

    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toMatch(/stopped unexpectedly/);
    expect(status()).toBe('Something went wrong');
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    await waitFor(() => expect(status()).toBe('Ready'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(client.load).toHaveBeenCalledTimes(2);
  });
});

describe('Options: Local Gemma card without WebGPU (audit H13)', () => {
  const cases: [GpuMode, RegExp][] = [
    ['absent', /^WebGPU is not available in this browser\.$/],
    ['no-adapter', /^WebGPU is present but no GPU adapter was found\.$/],
    ['throws', /^WebGPU is not available in this browser\.$/],
  ];
  for (const [mode, text] of cases) {
    it(`T3.17 navigator.gpu ${mode}: a clear message, and Download stays disabled`, async () => {
      const restore = stubGpu(mode);
      try {
        render(<LocalGemma settings={DEFAULT_AI_SETTINGS} onChange={() => {}} />);
        const gpu = screen.getByTestId('webgpu-status');
        await waitFor(() => expect(gpu.textContent).toMatch(text));
        expect(gpu.className).toContain('text-destructive');
        // Past 'checking', so only the GPU check can be what disables Download.
        await waitFor(() => expect(status()).toBe('Not downloaded'));
        const button = screen.getByRole('button', { name: 'Download & load' }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
        expect(client.load).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  }
});
