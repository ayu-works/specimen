import { sanitize } from '@specimen/core';
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
  for await (const d of provider.chat(req, signal)) {
    raw += d;
    if (onText) onText(safe(raw, scan));
  }
  return safe(raw, scan);
}

export function safe(text: string, scan: DesignScan): string {
  try {
    return sanitize(text, scan);
  } catch {
    // sanitize throws in dev/test builds if it can't remove the host; never show it.
    return '';
  }
}
