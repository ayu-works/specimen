// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalGemma } from '../src/entrypoints/options/LocalGemma';
import { DEFAULT_AI_SETTINGS } from '../src/lib/aiSettings';
import { installChrome } from './helpers/chrome';

/** The offscreen host, as the card's `WebLLMClient` sees it (same stub as localGemma.test.tsx). */
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

beforeEach(() => {
  installChrome();
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => ({}) },
  });
  client.status.mockResolvedValue({ loading: false, gpu: true, cached: true });
  client.load.mockReset();
  client.remove.mockReset();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'gpu');
  vi.unstubAllGlobals();
});

const status = () => screen.getByTestId('gemma-status').textContent;
const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

async function readyCard() {
  render(<LocalGemma settings={DEFAULT_AI_SETTINGS} onChange={() => {}} />);
  await waitFor(() => expect(status()).toBe('Ready'));
  await waitFor(() => expect(button(/Load now/).disabled).toBe(false));
}

describe('Options: Local Gemma card, delete (SPC-37)', () => {
  it('T3.37 while a delete runs, Download, Delete and the model choice are off; then "Not downloaded"', async () => {
    let finish = () => {};
    client.remove.mockReturnValueOnce(
      new Promise<void>((r) => {
        finish = r;
      }),
    );
    await readyCard();
    fireEvent.click(button(/Delete downloaded model/));
    await waitFor(() => expect(status()).toBe('Deleting…'));
    expect(button(/Load now|Download/).disabled).toBe(true);
    expect(button(/Delete downloaded model/).disabled).toBe(true);
    expect(screen.getAllByRole('radio')[0]?.closest('fieldset')?.disabled).toBe(true);
    // A click on Download meanwhile does nothing.
    fireEvent.click(button(/Load now|Download/));
    expect(client.load).not.toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).toBeNull();

    finish();
    await waitFor(() => expect(status()).toBe('Not downloaded'));
    expect(button(/Download & load/).disabled).toBe(false);
    expect(button(/Delete downloaded model/).disabled).toBe(true);

    // A download after the delete runs and ends ready, with nothing overwriting it.
    client.load.mockResolvedValueOnce(undefined);
    fireEvent.click(button(/Download & load/));
    await waitFor(() => expect(status()).toBe('Ready'));
    expect(client.load).toHaveBeenCalledTimes(1);
  });

  it('T3.37 a delete that fails shows the error and goes back to the state before it', async () => {
    client.remove.mockRejectedValueOnce(new Error('Could not clear the cache'));
    await readyCard();
    fireEvent.click(button(/Delete downloaded model/));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not clear the cache/);
    expect(status()).toBe('Ready');
    expect(button(/Load now/).disabled).toBe(false);
    expect(button(/Delete downloaded model/).disabled).toBe(false);
  });
});
