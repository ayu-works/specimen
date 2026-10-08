/**
 * Offscreen document: a hidden page the service worker can use for DOM-only APIs.
 * It is a message router (clipboard) plus the host of the local WebLLM engine (Port `llm`).
 */
import { llmBusy, startLlmHost } from './llmHost';

type Handler = (msg: never) => Promise<unknown>;

/** `navigator.clipboard` needs focus, so copy with a hidden textarea + execCommand. */
async function copy(msg: { text: string }): Promise<{ ok: true }> {
  const ta = document.createElement('textarea');
  ta.value = msg.text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.append(ta);
  try {
    ta.focus();
    ta.select();
    if (!document.execCommand('copy')) throw new Error('execCommand(copy) was rejected');
    return { ok: true };
  } finally {
    ta.remove();
  }
}

/** The background asks before closing this document: never while a model is loaded or loading. */
async function busy(): Promise<{ busy: boolean }> {
  return { busy: llmBusy() };
}

const ROUTES: Record<string, Handler> = {
  'offscreen.copy': copy as Handler,
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
