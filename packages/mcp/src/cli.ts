import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Bridge } from './bridge';
import { loadOrCreateToken, resolvePort } from './config';
import { createServer } from './server';

const err = (line: string) => process.stderr.write(`[specimen-mcp] ${line}\n`);
const out = (line = '') => process.stdout.write(`${line}\n`);

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
}

function localPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), 'cli.js');
}

function printPair(port: number): void {
  const token = loadOrCreateToken();
  out('Specimen pairing token (keep it private; it is stored in ~/.specimen/config.json):');
  out();
  out(`  ${token}`);
  out();
  out('Pair the Chrome extension:');
  out('  1. In Chrome, open Specimen > Settings (right-click the toolbar icon > Options).');
  out('  2. Under "Coding agents (MCP)", paste the token above.');
  out(
    '  3. Click Connect. The status turns to "Connected" once your agent has started specimen-mcp.',
  );
  if (port !== 7457) out(`  (Also set the port to ${port} under Advanced.)`);
  out();
  out(
    'Then add the server to your agent: `specimen-mcp config claude-code` or `specimen-mcp config cursor`.',
  );
}

function printConfig(which: string | undefined): void {
  const local = localPath();
  if (which === 'claude-code') {
    out('# Claude Code');
    out('claude mcp add specimen -- npx -y @specimen/mcp');
    out();
    out('# Running from a local checkout (until the package is published)');
    out(`claude mcp add specimen -- node ${/\s/.test(local) ? `"${local}"` : local}`);
  } else if (which === 'cursor') {
    out('# Cursor: add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project)');
    out(
      JSON.stringify(
        { mcpServers: { specimen: { command: 'npx', args: ['-y', '@specimen/mcp'] } } },
        null,
        2,
      ),
    );
    out();
    out('# Running from a local checkout (until the package is published)');
    out(JSON.stringify({ mcpServers: { specimen: { command: 'node', args: [local] } } }, null, 2));
  } else {
    err('usage: specimen-mcp config <claude-code|cursor>');
    process.exitCode = 1;
  }
}

async function serve(port: number): Promise<void> {
  const token = loadOrCreateToken();
  const bridge = new Bridge(token, err);
  const server = createServer(bridge);
  await bridge.listen(port);
  await server.connect(new StdioServerTransport());
  const stop = () => {
    bridge.close();
    process.exit(0);
  };
  process.stdin.on('close', stop);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  const port = resolvePort(flag(args, 'port'));
  if (cmd === 'pair') return printPair(port);
  if (cmd === 'config') return printConfig(args[1]);
  if (cmd === 'help' || args.includes('--help')) {
    out(
      'Usage: specimen-mcp [--port N]            run the MCP server (stdio) and the local bridge',
    );
    out('       specimen-mcp pair                  print the pairing token and instructions');
    out('       specimen-mcp config <claude-code|cursor>   print the config for your agent');
    return;
  }
  if (cmd) {
    err(`unknown command: ${cmd}`);
    process.exitCode = 1;
    return;
  }
  await serve(port);
}

main().catch((e: unknown) => {
  err(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
