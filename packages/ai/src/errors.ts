import { ProviderError } from './types';

/** Map an HTTP failure to a friendly ProviderError. The body is read only to find a short reason. */
export async function httpError(res: Response): Promise<ProviderError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
      const m = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message);
      detail = typeof m === 'string' ? m : '';
    } catch {
      detail = text;
    }
  } catch {
    /* body unreadable */
  }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 200);
  const suffix = detail ? ` (${detail})` : '';
  if (res.status === 401 || res.status === 403) {
    return new ProviderError('auth', `Invalid API key, or the key can't use this model${suffix}`);
  }
  if (res.status === 400 && /api[_ ]key/i.test(detail)) {
    return new ProviderError('auth', `Invalid API key${suffix}`);
  }
  if (res.status === 429)
    return new ProviderError('rate', `Rate limited, try again shortly${suffix}`);
  if (res.status >= 500)
    return new ProviderError('other', `The provider had a server error${suffix}`);
  return new ProviderError('other', `Request failed with HTTP ${res.status}${suffix}`);
}

/** Map anything thrown by fetch / a stream reader. */
export function mapThrown(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const name = (e as { name?: unknown } | null)?.name;
  if (name === 'AbortError') return new ProviderError('aborted', 'Stopped', { cause: e });
  if (e instanceof TypeError) {
    return new ProviderError(
      'network',
      "Can't reach the provider. Check your connection and the base URL.",
      {
        cause: e,
      },
    );
  }
  return new ProviderError('other', e instanceof Error ? e.message : String(e), { cause: e });
}
