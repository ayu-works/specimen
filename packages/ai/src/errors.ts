import { ProviderError } from './types';

/*
 * Every message built here is fixed text. Provider error bodies, stream error events and thrown
 * errors on the HTTP path are read only to pick a kind and are never copied into a message or a
 * `cause`: some providers echo the API key ("Incorrect API key provided: sk-…"), and these
 * errors reach the UI and stored chats.
 */

/** Shown when a 400 says the model can't take the image; `vibe` compares against it to retry text-only. */
export const IMAGE_REJECTED_TEXT = "This model can't read images.";
export const MID_STREAM_TEXT = 'The provider reported an error mid-response.';
export const HTTP_FAILED_TEXT = 'The provider request failed.';
/** A reply that stopped at the token limit; the council matches this exact text (SPC-34). */
export const TRUNCATED_TEXT = 'The answer hit the length limit and was cut off.';
export const TOO_LONG_TEXT =
  'The request is too long for this model. Ask a shorter question, or pick a model with a larger context.';

/** Providers phrase "this model can't take images" differently; treat these 400s as that. */
const IMAGE_REJECTED =
  /content must be a string|image_url|unsupported content|(?:does not|doesn't|cannot|can't|unable to) (?:support|accept|process|read|handle) (?:images?|image (?:input|content)|vision|multi-?modal)|(?:images?|image (?:input|content)|vision|multi-?modal)(?: input| content)? (?:is|are) not supported|not (?:a )?(?:vision|multi-?modal)(?: model)?/i;

export const RATE_TEXT =
  'The provider is rate-limiting requests. Wait a minute and try again, or pick a smaller model.';
/** No credit left on the account (SPC-30): waiting won't help, so callers never retry it. */
export const OUT_OF_CREDIT_TEXT =
  'Your provider account is out of credit. Add credit or billing with the provider, then try again.';

/**
 * Billing codes (OpenAI and hosts that copy its error shape). OpenAI's out-of-credit message
 * ("You exceeded your current quota…") is not matched: Gemini's per-minute limit uses the same words.
 */
const CREDIT_CODE = /^(?:insufficient_quota|billing_hard_limit_reached)$/;
/** Anthropic (400) and xAI (403) say it only in the message. */
const CREDIT_TEXT =
  /credit balance is too low|insufficient (?:balance|credits?|funds)|(?:out of|no) credits\b|doesn't have any credits|billing hard limit/i;

/** True when an error object's string `code` or `type` is a billing code. */
function creditCode(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { code, type } = e as Record<string, unknown>;
  return [code, type].some((v) => typeof v === 'string' && CREDIT_CODE.test(v));
}

/** Map an HTTP failure to a friendly ProviderError. The body is read only to classify it. */
export async function httpError(res: Response): Promise<ProviderError> {
  let detail = '';
  let billing = false;
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
      const m = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message);
      detail = typeof m === 'string' ? m : '';
      billing = creditCode(j.error);
    } catch {
      detail = text;
    }
  } catch {
    /* body unreadable */
  }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 500);
  // Before auth (xAI sends 403) and before rate (OpenAI sends 429).
  if (
    res.status === 402 ||
    billing ||
    ([400, 403, 429].includes(res.status) && CREDIT_TEXT.test(detail))
  ) {
    return new ProviderError('other', OUT_OF_CREDIT_TEXT);
  }
  if (res.status === 401 || res.status === 403) {
    return new ProviderError('auth', "Invalid API key, or the key can't use this model.");
  }
  if (res.status === 400 && /api[_ ]key/i.test(detail)) {
    return new ProviderError('auth', 'Invalid API key.');
  }
  if (res.status === 429 || /rate[_ -]?limit/i.test(detail)) {
    return new ProviderError('rate', RATE_TEXT);
  }
  if (res.status === 404 || /model.*(not (exist|found)|decommission|deprecat)/i.test(detail)) {
    return new ProviderError(
      'other',
      `This model isn't available for your key. In Settings, click "Fetch models" and pick one.`,
    );
  }
  if (
    [400, 413, 422].includes(res.status) &&
    /context[_ ]length|maximum context|too many tokens|prompt is too long|request too large|max_(?:completion_)?tokens/i.test(
      detail,
    )
  ) {
    return new ProviderError('other', TOO_LONG_TEXT);
  }
  // After the model-gone check: "gpt-4-vision-preview has been deprecated" is not an image rejection.
  if ((res.status === 400 || res.status === 422) && IMAGE_REJECTED.test(detail)) {
    return new ProviderError('other', IMAGE_REJECTED_TEXT);
  }
  if (res.status >= 500) {
    return new ProviderError('other', 'The provider had a server error. Try again in a minute.');
  }
  if (res.status === 400) {
    return new ProviderError(
      'other',
      'The provider rejected the request (HTTP 400). Check the model in Settings.',
    );
  }
  return new ProviderError('other', `Request failed with HTTP ${res.status}.`);
}

/**
 * Map an `{error: …}` event inside a 200 stream. Only the event's `type` / `code` / `status`
 * fields are looked at, to tell a rate limit or overload (so callers can back off) and an
 * out-of-credit account from the rest.
 */
export function streamError(err: unknown): ProviderError {
  const e = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
  if (creditCode(e)) return new ProviderError('other', OUT_OF_CREDIT_TEXT);
  const hint = [e.type, e.code, e.status].map((v) => String(v ?? '')).join(' ');
  if (/rate[_ -]?limit|overload|exhausted|\b429\b|\b529\b/i.test(hint))
    return new ProviderError('rate', RATE_TEXT);
  return new ProviderError('other', MID_STREAM_TEXT);
}

/**
 * Map anything thrown by fetch / a stream reader. With `fixedText` (the HTTP path) no thrown text
 * and no `cause` is kept: a fetch TypeError can carry the URL or a header value.
 */
export function mapThrown(e: unknown, opts: { fixedText?: boolean } = {}): ProviderError {
  if (e instanceof ProviderError) return e;
  const keep = opts.fixedText ? undefined : { cause: e };
  const name = (e as { name?: unknown } | null)?.name;
  if (name === 'AbortError') return new ProviderError('aborted', 'Stopped', keep);
  if (e instanceof TypeError) {
    return new ProviderError(
      'network',
      "Can't reach the provider. Check your connection and the base URL.",
      keep,
    );
  }
  if (opts.fixedText) return new ProviderError('other', HTTP_FAILED_TEXT);
  return new ProviderError('other', e instanceof Error ? e.message : String(e), keep);
}

/** The ` (<provider detail>)` suffix that messages carried before SPC-16. */
const LEGACY_SUFFIX = new RegExp(
  `^(${[
    "Invalid API key, or the key can't use this model",
    'Invalid API key',
    `This model isn't available for your key\\. In Settings, click "Fetch models" and pick one`,
    'The provider had a server error',
    'Request failed with HTTP \\d+',
  ].join('|')}) \\([\\s\\S]*\\)$`,
);
/**
 * Known key prefixes, plus any run of 32+ alphanumerics (Together, Mistral): error text never
 * needs one. A key may follow a non-alphanumeric or a URL-encoded `=` (`key%3DAIza…`).
 */
const KEY_SHAPES =
  /(?:(?<![A-Za-z0-9])|(?<=%3[Dd]))(?:sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,}|[A-Za-z0-9]{32,})/g;

/**
 * Clean a stored provider **error** string from before SPC-16 (the chat `error` field, not answer
 * text): it may hold provider detail that echoed the key. Drops the old ` (<detail>)` suffix when
 * the whole string is an old message, redacts key shapes, and redacts `knownKeys` (the user's
 * stored keys) verbatim and URL-encoded, which catches key formats no shape covers. Pure;
 * idempotent.
 */
export function scrubLegacyProviderText(text: string, knownKeys: readonly string[] = []): string {
  let out = text.replace(LEGACY_SUFFIX, '$1');
  for (const k of knownKeys) {
    if (k.length < 8) continue;
    for (const form of new Set([k, encodeURIComponent(k)]))
      out = out.split(form).join('[redacted]');
  }
  return out.replace(KEY_SHAPES, '[redacted]');
}
