import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DesignScan, extract, RawPageSchema } from '@specimen/core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures');

/** `name` is a page under raw/pages (e.g. "injection") or a real capture under raw (e.g. "real:stripe"). */
export function loadFixtureScan(name = 'landing-basic'): DesignScan {
  const file = name.startsWith('real:') ? `raw/${name.slice(5)}.json` : `raw/pages/${name}.json`;
  const raw = RawPageSchema.parse(JSON.parse(readFileSync(join(ROOT, file), 'utf8')));
  return extract(raw);
}

export function loadInjectionStrings(): string[] {
  const j = JSON.parse(readFileSync(join(ROOT, 'pages/injection.expected.json'), 'utf8')) as {
    injectionStrings: string[];
  };
  return j.injectionStrings;
}

/** Build an SSE `Response` from string chunks (chunk boundaries can split lines on purpose). */
export function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

/** A stream that emits one event then hangs until the signal aborts (for abort tests). */
export function hangingResponse(signal?: AbortSignal): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('data: {"x":1}\n\n'));
      signal?.addEventListener('abort', () => {
        try {
          c.error(new DOMException('Aborted', 'AbortError'));
        } catch {
          /* closed */
        }
      });
    },
  });
  return new Response(stream, { status: 200 });
}

export async function drain(it: AsyncIterable<string>): Promise<string> {
  let s = '';
  for await (const d of it) s += d;
  return s;
}
