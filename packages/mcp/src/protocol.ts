/** WebSocket messages between the Specimen extension and `specimen-mcp` (ARCHITECTURE §14). */

export const DEFAULT_PORT = 7457;
export const PROTOCOL_VERSION = 1;
export const HEARTBEAT_MS = 20_000;
export const REQUEST_TIMEOUT_MS = 60_000;

/** extension -> server */
export type ClientMessage =
  | { type: 'hello'; token: string; version: number }
  | { type: 'scan.push'; scan: unknown; tags?: string[] }
  | { type: 'scan.delete'; id: string }
  | { type: 'scan.result'; reqId: string; scan?: unknown; error?: string }
  | { type: 'ping' };

/** server -> extension */
export type ServerMessage =
  | { type: 'welcome'; version: number; scans: number }
  | { type: 'scan.request'; reqId: string; url: string }
  | { type: 'error'; reason: 'bad-token' | 'bad-hello' | 'bad-message' }
  | { type: 'pong' };
