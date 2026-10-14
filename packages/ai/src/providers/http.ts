import { httpError, mapThrown } from '../errors';
import { type SseEvent, sseEvents } from '../sse';
import { ProviderError } from '../types';

const EMPTY_TEXT = 'The provider returned an empty response';

/** POST JSON and yield SSE events, mapping every failure to a ProviderError. */
export async function* postSse(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
      credentials: 'omit',
    });
    if (!res.ok) throw await httpError(res);
    if (!res.body) throw new ProviderError('other', EMPTY_TEXT);
    let events = 0;
    for await (const ev of sseEvents(res.body, signal)) {
      events++;
      yield ev;
    }
    // A 200 with no events at all is a failure, not an empty answer.
    if (events === 0) throw new ProviderError('other', EMPTY_TEXT);
  } catch (e) {
    throw mapThrown(e, { fixedText: true });
  }
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
