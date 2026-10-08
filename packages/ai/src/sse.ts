export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Parse a Server-Sent-Events body into events. Handles chunk boundaries inside lines,
 * CRLF, comments, multi-line `data:` fields and a missing trailing blank line.
 */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort);
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | undefined;
  let data: string[] = [];

  const flush = (): SseEvent | null => {
    if (data.length === 0) {
      event = undefined;
      return null;
    }
    const out: SseEvent = { event, data: data.join('\n') };
    event = undefined;
    data = [];
    return out;
  };

  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r\n|\n|\r/);
      buffer = done ? '' : (lines.pop() ?? '');
      if (done && lines.length === 0) lines.push('');
      for (const line of lines) {
        if (line === '') {
          const ev = flush();
          if (ev) yield ev;
        } else if (line.startsWith(':')) {
          /* comment / keep-alive */
        } else {
          const i = line.indexOf(':');
          const field = i === -1 ? line : line.slice(0, i);
          let val = i === -1 ? '' : line.slice(i + 1);
          if (val.startsWith(' ')) val = val.slice(1);
          if (field === 'data') data.push(val);
          else if (field === 'event') event = val;
        }
      }
      if (done) {
        const ev = flush();
        if (ev) yield ev;
        return;
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock?.();
  }
}
