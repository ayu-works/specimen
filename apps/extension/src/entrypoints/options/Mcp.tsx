import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import {
  clearMcpToken,
  DEFAULT_MCP,
  DEFAULT_MCP_PORT,
  loadMcpSettings,
  loadMcpStatus,
  loadMcpToken,
  type McpSettings,
  type McpStatus,
  saveMcpSettings,
  saveMcpToken,
  watchMcp,
} from '@/lib/mcpSettings';
import { cn } from '@/lib/utils';
import { fieldClass } from './fields';

const PAIR_CMD = 'npx -y @specimen/mcp pair';
const LOCAL_PAIR_CMD = 'node /path/to/specimen/packages/mcp/dist/cli.js pair';
const CLAUDE_CMD = 'claude mcp add specimen -- npx -y @specimen/mcp';
const LOCAL_CLAUDE_CMD =
  'claude mcp add specimen -- node /path/to/specimen/packages/mcp/dist/cli.js';
const CURSOR_JSON = JSON.stringify(
  { mcpServers: { specimen: { command: 'npx', args: ['-y', '@specimen/mcp'] } } },
  null,
  2,
);

const PILL: Record<McpStatus['state'], { label: string; cls: string }> = {
  unpaired: { label: 'Not paired', cls: 'bg-muted text-muted-foreground' },
  connecting: { label: 'Connecting', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  connected: { label: 'Connected', cls: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  error: { label: 'Error', cls: 'bg-red-500/15 text-red-700 dark:text-red-400' },
};

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard blocked: the text stays selectable */
    }
  }
  return (
    <div className="flex items-start gap-2">
      <pre className="m-0 min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted px-2.5 py-2 text-xs">
        <code>{text}</code>
      </pre>
      <Button variant="outline" size="sm" onClick={() => void copy()} aria-label={label}>
        {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {done ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1.5">
      <span className="font-medium">
        {n}. {title}
      </span>
      {children}
    </li>
  );
}

export function Mcp() {
  const [settings, setSettings] = useState<McpSettings>(DEFAULT_MCP);
  const [status, setStatus] = useState<McpStatus>({ state: 'unpaired' });
  const [paired, setPaired] = useState(false);
  const [token, setToken] = useState('');
  const [port, setPort] = useState(String(DEFAULT_MCP_PORT));

  useEffect(() => {
    async function load() {
      const [s, st, t] = await Promise.all([loadMcpSettings(), loadMcpStatus(), loadMcpToken()]);
      setSettings(s);
      setPort(String(s.port));
      setStatus(t ? st : { state: 'unpaired' });
      setPaired(t !== null);
    }
    void load();
    return watchMcp(() => void load());
  }, []);

  async function connect() {
    if (!token.trim()) return;
    await saveMcpToken(token);
    setToken('');
  }

  async function disconnect() {
    await clearMcpToken();
  }

  async function savePort() {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setPort(String(settings.port));
      return;
    }
    setSettings(await saveMcpSettings({ port: n }));
  }

  const pill = PILL[status.state];

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="mb-0">Coding agents (MCP)</CardTitle>
        <span
          role="status"
          className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', pill.cls)}
        >
          {pill.label}
        </span>
      </div>
      <p className="text-muted-foreground">
        Let Claude Code or Cursor read your scans directly and check their builds against a design.
        Everything stays on this computer (127.0.0.1 only).
      </p>
      {status.reason && status.state !== 'unpaired' && (
        <p
          className={cn(
            'text-xs',
            status.state === 'error' ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground',
          )}
        >
          {status.reason}
        </p>
      )}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        <Step n={1} title="Get your pairing token">
          <CopyBlock label="Copy the pair command" text={PAIR_CMD} />
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Running from a source checkout?</summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
              <span>
                Run <code>pnpm -F @specimen/mcp build</code> once, then use your own path:
              </span>
              <CopyBlock label="Copy the local pair command" text={LOCAL_PAIR_CMD} />
            </div>
          </details>
        </Step>
        <Step n={2} title="Paste the token here">
          {paired ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Token saved on this device.</span>
              <Button variant="outline" size="sm" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void connect();
              }}
            >
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className={fieldClass}
                placeholder="Pairing token"
                aria-label="Pairing token"
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="submit" size="sm" disabled={!token.trim()}>
                Connect
              </Button>
            </form>
          )}
        </Step>
        <Step n={3} title="Add Specimen to your agent">
          <span className="text-xs text-muted-foreground">Claude Code (run in a terminal):</span>
          <CopyBlock label="Copy the Claude Code command" text={CLAUDE_CMD} />
          <span className="text-xs text-muted-foreground">
            Cursor (add to <code>~/.cursor/mcp.json</code>):
          </span>
          <CopyBlock label="Copy the Cursor config" text={CURSOR_JSON} />
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Running from a source checkout?</summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
              <CopyBlock label="Copy the local Claude Code command" text={LOCAL_CLAUDE_CMD} />
              <span>
                For Cursor, set <code>command</code> to <code>node</code> and <code>args</code> to
                the same path.
              </span>
            </div>
          </details>
        </Step>
      </ol>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.share}
          onChange={(e) => void saveMcpSettings({ share: e.target.checked }).then(setSettings)}
        />
        <span>Share scans with coding agents</span>
      </label>
      <p className="-mt-2 text-xs text-muted-foreground">
        Sends your Library scans (colors, type, spacing, no screenshots) to the local server on your
        computer. When off, agents can still ask Specimen to check a build.
      </p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Advanced</summary>
        <label className="mt-1.5 flex items-center gap-2">
          <span>Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            onBlur={() => void savePort()}
            className={cn(fieldClass, 'w-28')}
          />
          <span>Default {DEFAULT_MCP_PORT}. Must match the server's `--port`.</span>
        </label>
      </details>
    </Card>
  );
}
