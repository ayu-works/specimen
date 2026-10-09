/**
 * Offscreen document: a hidden page the service worker can use for DOM-only APIs.
 * It answers the background's `offscreen.busy` check and hosts the local WebLLM engine (Port `llm`).
 */
import { llmBusy, startLlmHost } from './llmHost';

type Handler = (msg: never) => Promise<unknown>;

/** The background asks before closing this document: never while a model is loaded or loading. */
async function busy(): Promise<{ busy: boolean }> {
  return { busy: llmBusy() };
}

const ROUTES: Record<string, Handler> = {
  'offscreen.busy': busy as Handler,
};

startLlmHost();

// Only answer messages we own: replying to others would race the real handler in the background.
chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  const type = (msg as { type?: unknown } | null)?.type;
  const handler = typeof type === 'string' ? ROUTES[type] : undefined;
  if (!handler) return false;
  (handler as (m: unknown) => Promise<unknown>)(msg).then(
    (data) => sendResponse({ ok: true, data }),
    (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
  return true;
});
