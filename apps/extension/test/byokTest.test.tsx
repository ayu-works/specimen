// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Byok } from '../src/entrypoints/options/Byok';
import { DEFAULT_AI_SETTINGS } from '../src/lib/aiSettings';
import { installChrome } from './helpers/chrome';

/*
 * SPC-41: the Settings "Test" call caps the reply at 32 tokens. A reasoning model can spend all of
 * them thinking and stop at the limit with no text; that key and model work, so Test must say so.
 */

const KEY = 'test-key';
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

let reply: () => Response;

beforeEach(() => {
  installChrome();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply()),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function run(preset: string) {
  render(<Byok settings={DEFAULT_AI_SETTINGS} onChange={() => {}} />);
  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: preset } });
  fireEvent.change(screen.getByPlaceholderText('Paste your key'), { target: { value: KEY } });
  fireEvent.click(screen.getByRole('button', { name: 'Test' }));
}

describe('Options: Test with a reasoning model (SPC-41)', () => {
  const cut: [string, string, () => Response][] = [
    [
      'groq',
      'finish_reason "length"',
      () =>
        sse(
          { choices: [{ delta: { reasoning: 'Thinking…' }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: 'length' }] },
        ),
    ],
    [
      'gemini',
      'finishReason "MAX_TOKENS"',
      () => sse({ candidates: [{ finishReason: 'MAX_TOKENS' }] }),
    ],
    [
      'anthropic',
      'stop_reason "max_tokens"',
      () =>
        sse(
          { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
          { type: 'message_stop' },
        ),
    ],
  ];
  for (const [preset, how, res] of cut) {
    it(`T3.13 test: ${preset} stopping at the token limit with no text reports connected (${how})`, async () => {
      reply = res;
      run(preset);
      const ok = await screen.findByText(/Works: connected to/);
      expect(ok.getAttribute('role')).toBe('status');
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }

  it('T3.13 test: a real failure still shows an error', async () => {
    reply = () => new Response('{"error":{"message":"bad key"}}', { status: 401 });
    run('groq');
    expect((await screen.findByRole('alert')).textContent).toMatch(/key/i);
  });
});
