import type { RawPage } from '@specimen/core/schema';

/** Request/response shapes keyed by message type (ARCHITECTURE §8). */
export interface MessageMap {
  'scan.run': { req: { tabId: number; opts?: Record<string, never> }; res: ScanResult };
  'css.fetch': { req: { urls: string[] }; res: { texts: (string | null)[] } };
  // Declared for later phases; the background answers these with "not implemented".
  'overlay.set': {
    req: {
      tabId: number;
      grid?: boolean;
      inspector?: boolean;
      highlight?: { tokenId: string; selectorHints: string[]; hex?: string } | null;
      /** Grid geometry from the scan (grid overlay). */
      gridSpec?: { containerMaxWidth: number | null; gutter: number | null; baseUnit: number };
      /** Palette hexes the inspector matches hovered colours against. */
      tokens?: { id: string; hex: string }[];
    };
    res: { ok: true };
  };
  'offscreen.ensure': { req: Record<string, never>; res: { ok: boolean } };
}

/** Payload streamed over Port `inspector` (content -> side panel). */
export interface InspectorHover {
  rect: { x: number; y: number; w: number; h: number };
  tag: string;
  styles: Record<
    | 'color'
    | 'backgroundColor'
    | 'fontFamily'
    | 'fontSize'
    | 'fontWeight'
    | 'lineHeight'
    | 'padding'
    | 'borderRadius',
    string
  >;
  matchedTokens: { id: string; hex: string; prop: 'color' | 'backgroundColor' }[];
}

export interface ScanResult {
  raw: RawPage;
  /** `data:image/jpeg;base64,...`, 640px wide. */
  screenshot: string;
}

export type MessageType = keyof MessageMap;

/** Discriminated union of every message on the wire. */
export type Message = {
  [K in MessageType]: { type: K } & MessageMap[K]['req'];
}[MessageType];

export type Response<K extends MessageType> =
  | { ok: true; data: MessageMap[K]['res'] }
  | { ok: false; error: string };

/** Send a typed message to the background and unwrap its response (throws on error). */
export async function send<K extends MessageType>(
  type: K,
  payload: MessageMap[K]['req'],
): Promise<MessageMap[K]['res']> {
  const res = (await chrome.runtime.sendMessage({ type, ...payload })) as Response<K> | undefined;
  if (!res) throw new Error(`no response for ${type}`);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export type Handlers = {
  [K in MessageType]?: (
    msg: { type: K } & MessageMap[K]['req'],
    sender: chrome.runtime.MessageSender,
  ) => Promise<MessageMap[K]['res']>;
};

/** Register async handlers; unknown or unimplemented types get an error response. */
export function listen(handlers: Handlers): void {
  chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
    const handler = handlers[msg.type] as
      | ((m: Message, s: chrome.runtime.MessageSender) => Promise<unknown>)
      | undefined;
    if (!handler) {
      sendResponse({ ok: false, error: `not implemented: ${msg.type}` });
      return false;
    }
    handler(msg, sender).then(
      (data) => sendResponse({ ok: true, data }),
      (e: unknown) =>
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  });
}
