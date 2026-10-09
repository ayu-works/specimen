// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { Byok } from '../src/entrypoints/options/Byok';
import { type AiSettings, DEFAULT_AI_SETTINGS } from '../src/lib/aiSettings';
import { type FakeChrome, installChrome } from './helpers/chrome';

const KEY = 'sk-ant-test-key-1234567890';
const enc = new TextEncoder();

function sse(...events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(body));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

const ANSWER = sse(
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
  { type: 'message_stop' },
);

let chrome: FakeChrome;
let fetchMock: ReturnType<typeof vi.fn>;
let onChange: Mock<(s: AiSettings) => void>;
let logs: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  chrome = installChrome();
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'claude-a' }, { id: 'claude-b' }] }), {
        status: 200,
      });
    }
    return ANSWER.clone();
  });
  vi.stubGlobal('fetch', fetchMock);
  onChange = vi.fn();
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Like the Options page: a saved change flows back in as the new `settings` prop. */
function Host() {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  return (
    <Byok
      settings={settings}
      onChange={(s) => {
        setSettings(s);
        onChange(s);
      }}
    />
  );
}
const renderByok = () => render(<Host />);
const typeKey = (value = KEY) =>
  fireEvent.change(screen.getByPlaceholderText('Paste your key'), { target: { value } });
const click = (name: RegExp | string) => fireEvent.click(screen.getByRole('button', { name }));
const keyState = () => screen.getByTestId('key-state').textContent;

describe('Options: API key (component)', () => {
  it('T3.13 add: Save stores the key in storage.local only and reports it saved', async () => {
    renderByok();
    expect(keyState()).toBe('No key saved.');
    typeKey();
    click('Save');

    await screen.findByText('Saved.');
    expect(chrome.storage.local.data.get('secrets.anthropic')).toEqual({
      v: 1,
      enc: false,
      key: KEY,
    });
    // Never synced, and the provider choice is persisted.
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect((chrome.storage.local.data.get('settings.ai') as AiSettings).provider).toBe('byok');
    expect(onChange).toHaveBeenCalled();
    await waitFor(() => expect(keyState()).toBe('A key is saved on this device.'));
    // The key field was cleared after saving.
    expect((screen.getByPlaceholderText('Saved. Paste to replace') as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('T3.13 test: sends the key to the provider and reports success', async () => {
    renderByok();
    typeKey();
    click('Test');
    await screen.findByText(/Works: .* answered\./);

    const [url, init] =
      fetchMock.mock.calls.find((c) => String(c[0]).includes('/v1/messages')) ?? [];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': KEY });
    // Testing does not save anything.
    expect(chrome.storage.local.data.has('secrets.anthropic')).toBe(false);
  });

  it('T3.13 test: a rejected key shows a friendly error, not a raw HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"nope"}}', { status: 401 }));
    renderByok();
    typeKey('sk-bad');
    click('Test');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/invalid|key/i);
    expect(alert.textContent).not.toContain('401');
  });

  it('T3.13 fetch models lists the provider models', async () => {
    renderByok();
    typeKey();
    click(/Fetch models/);
    await screen.findByText(/2 models available/);
    expect(document.querySelectorAll('#byok-models option')).toHaveLength(2);
  });

  it('T3.13 remove: deletes the saved key and clears the provider', async () => {
    chrome.storage.local.data.set('secrets.anthropic', { v: 1, enc: false, key: KEY });
    renderByok();
    await waitFor(() => expect(keyState()).toBe('A key is saved on this device.'));
    click('Remove key');
    await screen.findByText('Key removed.');
    expect(chrome.storage.local.data.has('secrets.anthropic')).toBe(false);
    await waitFor(() => expect(keyState()).toBe('No key saved.'));
    expect(onChange).toHaveBeenCalled();
  });

  it('T3.13 the key is never written to any console method', async () => {
    renderByok();
    typeKey();
    click(/Fetch models/);
    await screen.findByText(/models available/);
    click('Test');
    await screen.findByText(/Works:/);
    click('Save');
    await screen.findByText('Saved.');
    for (const spy of logs) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
    }
  });
});
