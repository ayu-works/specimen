/**
 * MCP bridge settings (ARCHITECTURE §14). The pairing token lives in `chrome.storage.local`
 * under `secrets.mcpToken` (never `storage.sync`, never logged). The live connection status is
 * written by the background to `chrome.storage.session` and read by the options page.
 */
export const KEY_MCP = 'settings.mcp';
export const KEY_MCP_TOKEN = 'secrets.mcpToken';
export const KEY_MCP_STATUS = 'session.mcpStatus';

export const DEFAULT_MCP_PORT = 7457;
export const MCP_HEARTBEAT_MS = 20_000;

export interface McpSettings {
  /** Push Library scans (and changes) to the paired server. */
  share: boolean;
  port: number;
}

export const DEFAULT_MCP: McpSettings = { share: true, port: DEFAULT_MCP_PORT };

export type McpState = 'unpaired' | 'connecting' | 'connected' | 'error';
export interface McpStatus {
  state: McpState;
  reason?: string;
}

export async function loadMcpSettings(): Promise<McpSettings> {
  try {
    const got = await chrome.storage.local.get(KEY_MCP);
    const s = got[KEY_MCP] as Partial<McpSettings> | undefined;
    const port = Number(s?.port);
    return {
      share: s?.share ?? DEFAULT_MCP.share,
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_MCP_PORT,
    };
  } catch {
    return DEFAULT_MCP;
  }
}

export async function saveMcpSettings(patch: Partial<McpSettings>): Promise<McpSettings> {
  const next = { ...(await loadMcpSettings()), ...patch };
  await chrome.storage.local.set({ [KEY_MCP]: next });
  return next;
}

export async function loadMcpToken(): Promise<string | null> {
  try {
    const got = await chrome.storage.local.get(KEY_MCP_TOKEN);
    const t = got[KEY_MCP_TOKEN];
    return typeof t === 'string' && t ? t : null;
  } catch {
    return null;
  }
}

export async function saveMcpToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [KEY_MCP_TOKEN]: token.trim() });
}

export async function clearMcpToken(): Promise<void> {
  await chrome.storage.local.remove(KEY_MCP_TOKEN);
}

export async function loadMcpStatus(): Promise<McpStatus> {
  try {
    const got = await chrome.storage.session.get(KEY_MCP_STATUS);
    return (got[KEY_MCP_STATUS] as McpStatus | undefined) ?? { state: 'unpaired' };
  } catch {
    return { state: 'unpaired' };
  }
}

/** Fire `cb` when the MCP settings, token or connection status change. */
export function watchMcp(cb: () => void): () => void {
  const onChange = (changes: Record<string, unknown>, area: string) => {
    const keys = Object.keys(changes);
    if (area === 'local' && keys.some((k) => k === KEY_MCP || k === KEY_MCP_TOKEN)) cb();
    if (area === 'session' && keys.includes(KEY_MCP_STATUS)) cb();
  };
  chrome.storage.onChanged.addListener(onChange);
  return () => chrome.storage.onChanged.removeListener(onChange);
}
