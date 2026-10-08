import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'pages');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Serve fixtures/pages on a random localhost port. */
export function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
      const rel = normalize(path === '/' ? '/landing-basic.html' : path);
      if (rel.includes('..')) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const body = await readFile(join(PAGES_DIR, rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
            server.closeAllConnections();
          }),
      });
    });
  });
}
