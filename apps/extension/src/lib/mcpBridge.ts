/**
 * WebSocket client to the local `specimen-mcp` bridge (background service worker only).
 * Connects to ws://127.0.0.1:<port> when a pairing token is stored, pushes Library scans, and
 * answers `scan.request` by scanning a URL in a background tab. An open WebSocket keeps the MV3
 * service worker alive (Chrome 116+); the 20 s heartbeat is also activity. The token is never
 * logged.
 */
import { extract } from '@specimen/core';
import type { DesignScan, RawPage } from '@specimen/core/schema';
import { db, listScans, type StoredScan } from './db';
import {
  KEY_MCP,
  KEY_MCP_STATUS,
  KEY_MCP_TOKEN,
  loadMcpSettings,
  loadMcpToken,
  MCP_HEARTBEAT_MS,
  type McpStatus,
} from './mcpSettings';

const PROTOCOL_VERSION = 1;
const MAX_BACKOFF_MS = 30_000;
const MAX_BUFFERED = 8 * 1024 * 1024;
const SETTLE_MS = 800;

type ServerMessage =
  | { type: 'welcome'; version: number; scans: number }
  | { type: 'scan.request'; reqId: string; url: string }
  | { type: 'error'; reason: string }
  | { type: 'pong' };

export interface BridgeDeps {
  /** Scan a tab and return the raw page (no thumbnail, nothing saved). */
  scanTab: (tabId: number) => Promise<RawPage>;
  waitForTabLoad: (tabId: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class McpBridge {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private port = 0;
  private share = true;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private status: McpStatus = { state: 'unpaired' };
  private authFailed = false;

  constructor(private readonly deps: BridgeDeps) {}

  /** Re-read settings and token, then connect, reconnect or disconnect as needed. */
  async refresh(): Promise<void> {
    const [token, settings] = await Promise.all([loadMcpToken(), loadMcpSettings()]);
    const changed = token !== this.token || settings.port !== this.port;
    this.token = token;
    this.port = settings.port;
    const sharingNow = settings.share;
    const justEnabled = sharingNow && !this.share;
    this.share = sharingNow;
    if (!token) {
      this.teardown();
      this.setStatus({ state: 'unpaired' });
      return;
    }
    if (changed) {
      this.authFailed = false;
      this.teardown();
      this.attempt = 0;
      this.connect();
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (justEnabled) void this.pushAll();
    } else if (!this.ws && !this.retry && !this.authFailed) {
      this.connect();
    }
  }

  /** Push one scan from the Library (no-op unless connected and sharing). */
  async pushScan(id: string): Promise<void> {
    if (!this.canShare()) return;
    const row = await db.scans.get(id);
    if (row) this.sendScan(row);
  }

  deleteScans(ids: string[]): void {
    if (!this.canShare()) return;
    for (const id of ids) this.send({ type: 'scan.delete', id });
  }

  private canShare(): boolean {
    return (
      this.share && this.ws?.readyState === WebSocket.OPEN && this.status.state === 'connected'
    );
  }

  private setStatus(s: McpStatus): void {
    this.status = s;
    void chrome.storage.session.set({ [KEY_MCP_STATUS]: s }).catch(() => {});
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private sendScan(row: StoredScan): void {
    this.send({ type: 'scan.push', scan: row, tags: row.tags });
  }

  private async pushAll(): Promise<void> {
    const scans = await listScans();
    for (const row of scans) {
      if (!this.canShare()) return;
      this.sendScan(row);
      // Let the socket drain so a big library doesn't balloon memory.
      while (this.ws && this.ws.bufferedAmount > MAX_BUFFERED) await sleep(50);
    }
  }

  private teardown(): void {
    if (this.retry) clearTimeout(this.retry);
    if (this.beat) clearInterval(this.beat);
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.retry = this.beat = this.keepAlive = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
  }

  private connect(): void {
    if (!this.token) return;
    this.setStatus({ state: 'connecting' });
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    } catch {
      this.scheduleRetry('Could not open the connection.');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.token)
        ws.send(JSON.stringify({ type: 'hello', token: this.token, version: PROTOCOL_VERSION }));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      void this.onMessage(msg);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.beat) clearInterval(this.beat);
      this.beat = null;
      if (this.authFailed) return;
      this.scheduleRetry(
        'Waiting for specimen-mcp. It starts when your coding agent does; nothing to do here.',
      );
    };
  }

  /** Reconnect with exponential backoff (1 s … 30 s). Keeps the worker alive while waiting. */
  private scheduleRetry(reason: string): void {
    this.setStatus({ state: 'connecting', reason });
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt++);
    if (!this.keepAlive) {
      // A worker with no open socket is stopped after ~30 s; this cheap call keeps it running.
      this.keepAlive = setInterval(
        () => void chrome.runtime.getPlatformInfo().catch(() => {}),
        20_000,
      );
    }
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.token) this.connect();
    }, delay);
  }

  private async onMessage(msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case 'welcome':
        this.attempt = 0;
        if (this.keepAlive) clearInterval(this.keepAlive);
        this.keepAlive = null;
        this.setStatus({ state: 'connected' });
        this.beat = setInterval(() => this.send({ type: 'ping' }), MCP_HEARTBEAT_MS);
        if (this.share) await this.pushAll();
        return;
      case 'error':
        if (msg.reason === 'bad-token') {
          this.authFailed = true;
          this.setStatus({
            state: 'error',
            reason: 'The server rejected the token. Run `specimen-mcp pair` and paste the new one.',
          });
          this.teardown();
        }
        return;
      case 'scan.request':
        await this.answerRequest(msg.reqId, msg.url);
        return;
      default:
        return;
    }
  }

  private async answerRequest(reqId: string, url: string): Promise<void> {
    try {
      const scan = await this.scanUrl(url);
      this.send({ type: 'scan.result', reqId, scan });
    } catch (e) {
      this.send({ type: 'scan.result', reqId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Open `url` in a background tab, wait for it to settle, scan it (nothing is saved), close it. */
  private async scanUrl(url: string): Promise<DesignScan> {
    if (!isLocalDevUrl(url)) {
      throw new Error(
        'check_build only scans local development servers (localhost, 127.0.0.1, *.localhost, *.test). Run your build locally and pass its local URL.',
      );
    }
    if (!(await chrome.permissions.contains({ origins: ['<all_urls>'] }))) {
      throw new Error(
        'Specimen has no site access yet. Open the Specimen side panel and scan any page once (Chrome will ask for access), then try again.',
      );
    }
    const tab = await chrome.tabs.create({ url, active: false });
    const id = tab.id;
    if (id === undefined) throw new Error('Could not open a tab.');
    try {
      await this.deps.waitForTabLoad(id);
      await sleep(SETTLE_MS);
      return extract(await this.deps.scanTab(id));
    } finally {
      await chrome.tabs.remove(id).catch(() => {});
    }
  }
}

/** Storage keys that should trigger `refresh()`. */
export function isMcpKey(key: string): boolean {
  return key === KEY_MCP || key === KEY_MCP_TOKEN;
}

/**
 * Agents may only make the browser scan local dev servers. Scanning arbitrary sites would let a
 * (possibly prompt-injected) agent open the user's logged-in pages and read back measured text.
 */
export function isLocalDevUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h.endsWith('.localhost') ||
    h.endsWith('.test')
  );
}
