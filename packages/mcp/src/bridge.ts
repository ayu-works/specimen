import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { type DesignScan, migrate } from '@specimen/core';
import { type WebSocket, WebSocketServer } from 'ws';
import {
  type ClientMessage,
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  REQUEST_TIMEOUT_MS,
  type ServerMessage,
} from './protocol';
import { countEntries, deleteScan, isValidId, saveScan } from './store';

const HELLO_TIMEOUT_MS = 5_000;
const MAX_PAYLOAD = 64 * 1024 * 1024;
const HOST = '127.0.0.1';

const sha = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time token comparison (hash both sides so the lengths always match). */
export function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  return timingSafeEqual(sha(given), sha(expected));
}

interface Pending {
  resolve: (scan: DesignScan) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export const NOT_CONNECTED =
  'Specimen extension is not connected. Open Chrome with Specimen and pair it: run `specimen-mcp pair`.';

/**
 * The local WebSocket bridge. Binds to 127.0.0.1 only; accepts only `chrome-extension://`
 * origins; the first message must be `hello` with the pairing token. The token is never logged.
 */
export class Bridge {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private beat: NodeJS.Timeout | null = null;
  /** Called after the stored scans change (so MCP clients can be told). */
  onChange: () => void = () => {};

  constructor(
    private readonly token: string,
    private readonly log: (line: string) => void,
  ) {}

  get connected(): boolean {
    return this.client !== null && this.client.readyState === this.client.OPEN;
  }

  /** Resolves true when listening, false when the port is taken (another instance owns it). */
  listen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const wss = new WebSocketServer({
        host: HOST,
        port,
        maxPayload: MAX_PAYLOAD,
        verifyClient: ({ origin }: { origin: string }) =>
          typeof origin === 'string' && /^chrome-extension:\/\//.test(origin),
      });
      wss.once('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE') {
          this.log(
            `port ${port} is in use (another specimen-mcp?): serving saved scans only, no live bridge`,
          );
        } else {
          this.log(`bridge failed to start: ${e.message}`);
        }
        wss.close();
        resolve(false);
      });
      wss.once('listening', () => {
        this.wss = wss;
        wss.on('connection', (ws) => this.onConnection(ws));
        wss.on('error', () => {});
        this.beat = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
        this.beat.unref();
        this.log(`bridge listening on ${HOST}:${port}`);
        resolve(true);
      });
    });
  }

  close(): void {
    if (this.beat) clearInterval(this.beat);
    this.client?.close();
    this.wss?.close();
  }

  /** Ask the paired extension to scan `url`. Rejects when not connected or after 60 s. */
  requestScan(url: string): Promise<DesignScan> {
    const ws = this.client;
    if (!ws || ws.readyState !== ws.OPEN) return Promise.reject(new Error(NOT_CONNECTED));
    const reqId = randomUUID();
    return new Promise<DesignScan>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error('Timed out after 60 s waiting for the extension to scan the page.'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, reject, timer });
      this.send(ws, { type: 'scan.request', reqId, url });
    });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private heartbeat(): void {
    const ws = this.client;
    if (!ws) return;
    const alive = (ws as WebSocket & { alive?: boolean }).alive !== false;
    if (!alive) {
      ws.terminate();
      return;
    }
    (ws as WebSocket & { alive?: boolean }).alive = false;
    ws.ping();
  }

  private failPending(reason: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  private onConnection(ws: WebSocket): void {
    let authed = false;
    const helloTimer = setTimeout(() => {
      if (!authed) ws.close(4401, 'hello timeout');
    }, HELLO_TIMEOUT_MS);

    ws.on('pong', () => {
      (ws as WebSocket & { alive?: boolean }).alive = true;
    });

    ws.on('message', (data) => {
      (ws as WebSocket & { alive?: boolean }).alive = true;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        this.send(ws, { type: 'error', reason: 'bad-message' });
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (!authed) {
        if (msg.type !== 'hello') {
          this.send(ws, { type: 'error', reason: 'bad-hello' });
          ws.close(4400, 'hello required');
          return;
        }
        if (!tokenMatches(msg.token, this.token)) {
          this.send(ws, { type: 'error', reason: 'bad-token' });
          ws.close(4401, 'bad token');
          return;
        }
        authed = true;
        clearTimeout(helloTimer);
        const previous = this.client;
        this.client = ws;
        if (previous && previous !== ws) previous.close(4000, 'replaced by a newer connection');
        this.send(ws, { type: 'welcome', version: PROTOCOL_VERSION, scans: countEntries() });
        this.log('extension paired and connected');
        return;
      }
      this.handle(msg);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (this.client === ws) {
        this.client = null;
        this.failPending('The Specimen extension disconnected.');
        this.log('extension disconnected');
      }
    });
    ws.on('error', () => {});
  }

  private handle(msg: ClientMessage): void {
    switch (msg.type) {
      case 'ping':
        if (this.client) this.send(this.client, { type: 'pong' });
        return;
      case 'scan.push':
        try {
          saveScan(msg.scan, msg.tags);
          this.onChange();
        } catch {
          this.log('ignored an invalid scan from the extension');
        }
        return;
      case 'scan.delete':
        if (isValidId(msg.id)) {
          deleteScan(msg.id);
          this.onChange();
        }
        return;
      case 'scan.result': {
        const p = this.pending.get(msg.reqId);
        if (!p) return;
        this.pending.delete(msg.reqId);
        clearTimeout(p.timer);
        if (msg.error) {
          p.reject(new Error(msg.error));
          return;
        }
        try {
          // Validate (and migrate) before anything reads it; build scans are not stored.
          p.resolve(migrate(msg.scan));
        } catch {
          p.reject(new Error('The extension returned an invalid scan.'));
        }
        return;
      }
      default:
        return;
    }
  }
}
