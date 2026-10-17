/**
 * "The Library changed" ping between open side panels (SPC-43). A panel re-lists on receipt;
 * the message carries no ids, titles or page data, only that something was written.
 */

const NAME = 'specimen-library';
const TYPE = 'library-changed';

let sender: BroadcastChannel | null = null;

function open(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const ch = new BroadcastChannel(NAME);
  // Node (tests) keeps the process alive for an open channel; Chrome has no `unref`.
  (ch as { unref?: () => void }).unref?.();
  return ch;
}

/** Tell other panels to re-read the Library. Never throws: a write that committed stays committed. */
export function notifyLibraryChanged(): void {
  try {
    sender ??= open();
    sender?.postMessage({ type: TYPE });
  } catch {
    /* no channel here: other panels stay as they are until they re-list */
  }
}

/** Call `cb` once per burst of pings (trailing debounce). Returns the unsubscribe, which closes the channel. */
export function onLibraryChanged(cb: () => void, { debounceMs = 150 } = {}): () => void {
  let ch: BroadcastChannel | null;
  try {
    ch = open();
  } catch {
    ch = null;
  }
  if (!ch) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  ch.onmessage = (e: MessageEvent) => {
    const d = e.data as { type?: unknown } | null;
    if (!d || typeof d !== 'object' || d.type !== TYPE) return;
    clearTimeout(timer);
    timer = setTimeout(cb, debounceMs);
  };
  return () => {
    clearTimeout(timer);
    if (!ch) return;
    const c = ch;
    ch = null;
    try {
      c.onmessage = null;
      c.close();
    } catch {
      /* already closed */
    }
  };
}
