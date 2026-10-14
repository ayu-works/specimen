// A static file server for site/ that behaves like Netlify for what the tests check: pretty URLs
// (`/privacy/` serves privacy/index.html; `/privacy` gets a 301 to it), the netlify.toml short-link redirects and
// response headers (so the live CSP applies locally too), and a 404 for anything else.
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { type NetlifyConfig, shortLink } from './netlify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.woff2': 'font/woff2',
};

export interface SiteServer {
  origin: string;
  close: () => Promise<void>;
}

/** A file to serve, a trailing-slash redirect (as Netlify's pretty URLs do), or nothing. */
async function resolveFile(
  root: string,
  urlPath: string,
): Promise<{ file: string } | { redirect: string } | null> {
  const decoded = decodeURIComponent(urlPath);
  const target = path.resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(root + path.sep)) return null; // escapes the root
  const s = await stat(target).catch(() => null);
  if (s?.isFile()) return { file: target };
  if (!s?.isDirectory()) return null;
  if (!urlPath.endsWith('/')) return { redirect: `${urlPath}/` };
  const index = path.join(target, 'index.html');
  return (await stat(index).catch(() => null))?.isFile() ? { file: index } : null;
}

export async function serveSite(rootDir: string, config: NetlifyConfig): Promise<SiteServer> {
  const root = path.resolve(rootDir);
  const server = createServer(async (req, res) => {
    const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
    for (const [k, v] of Object.entries(config.headers)) res.setHeader(k, v);
    const redirect = shortLink(config.redirects, urlPath);
    if (redirect) {
      res.writeHead(redirect.status, { Location: redirect.to }).end();
      return;
    }
    const found = await resolveFile(root, urlPath).catch(() => null);
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    if ('redirect' in found) {
      res.writeHead(301, { Location: found.redirect }).end();
      return;
    }
    const { file } = found;
    const body = await readFile(file);
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
