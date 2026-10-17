import { createStreamSanitizer, sanitize } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';
import type { ChatRequest, LLMProvider } from '../types';

/**
 * Stream a chat and report the sanitized running text after each delta (the ethics guardrail
 * can only judge whole text, so callers get snapshots, not raw deltas). Returns the final text.
 */
export async function collect(
  provider: LLMProvider,
  scan: DesignScan,
  req: ChatRequest,
  onText?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let raw = '';
  const snapshot = safeStream(scan);
  for await (const d of provider.chat(req, signal)) {
    raw += d;
    if (onText) onText(snapshot(raw));
  }
  return safe(raw, scan);
}

/**
 * Sanitized text, or `''` on any sanitizer error: it fails closed and never returns the raw text.
 * (sanitize throws in dev/test builds if it can't remove the host.)
 */
export function safe(text: string, scan: DesignScan): string {
  try {
    return sanitize(text, scan);
  } catch {
    return '';
  }
}

/**
 * `safe` for running snapshots of one stream: finished lines are sanitized once (see
 * `createStreamSanitizer`), so a long reply costs O(length), not O(deltas × length). Fails closed
 * like `safe`. The final text still goes through `safe`.
 */
export function safeStream(scan: DesignScan): (raw: string) => string {
  const next = createStreamSanitizer(scan);
  return (raw) => {
    try {
      return next(raw);
    } catch {
      return '';
    }
  };
}
