import { httpError, mapThrown } from '../errors';
import { type SseEvent, sseEvents } from '../sse';
import { ProviderError } from '../types';

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
    if (!res.body) throw new ProviderError('other', 'The provider returned an empty response');
    yield* sseEvents(res.body, signal);
  } catch (e) {
    throw mapThrown(e);
  }
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
