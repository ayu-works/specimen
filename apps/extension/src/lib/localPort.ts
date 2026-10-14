/**
 * An in-memory pair of Port-like ends. A page can't `chrome.runtime.connect` to its own
 * `onConnect`, so the council host (offscreen document) reaches the WebLLM host in the same
 * document through this pair. Delivery is async and copied, like a real Port.
 */
type Cb = (m: never) => void;

export interface LocalPort {
  name: string;
  postMessage(msg: unknown): void;
  onMessage: { addListener(cb: Cb): void; removeListener(cb: Cb): void };
  onDisconnect: { addListener(cb: () => void): void; removeListener(cb: () => void): void };
  disconnect(): void;
}

export function createPortPair(name: string): [LocalPort, LocalPort] {
  let open = true;
  const sides = [0, 1].map(() => ({ msg: new Set<Cb>(), disc: new Set<() => void>() }));
  const end = (i: 0 | 1): LocalPort => {
    const self = sides[i] as (typeof sides)[number];
    const other = sides[1 - i] as (typeof sides)[number];
    return {
      name,
      postMessage(m) {
        if (!open) throw new Error('Attempting to use a disconnected port object');
        const copy = structuredClone(m) as never;
        queueMicrotask(() => {
          if (open) for (const cb of other.msg) cb(copy);
        });
      },
      onMessage: {
        addListener: (cb) => self.msg.add(cb),
        removeListener: (cb) => self.msg.delete(cb),
      },
      onDisconnect: {
        addListener: (cb) => self.disc.add(cb),
        removeListener: (cb) => self.disc.delete(cb),
      },
      // Like Chrome: only the other end hears the disconnect; both ends stop working.
      disconnect() {
        if (!open) return;
        open = false;
        for (const cb of other.disc) queueMicrotask(cb);
      },
    };
  };
  return [end(0), end(1)];
}
