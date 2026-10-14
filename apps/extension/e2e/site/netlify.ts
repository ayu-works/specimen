// Reads the parts of netlify.toml the website tests need: the short-link redirects (the canonical
// Chrome Web Store and GitHub URLs) and the response headers (the CSP the live site is served with).
// A tiny line parser, not a full TOML one: netlify.toml only uses tables, arrays of tables and
// `key = "string"` / `key = number` pairs.

export interface Redirect {
  from: string;
  to: string;
  status: number;
}

export interface NetlifyConfig {
  redirects: Redirect[];
  /** Headers for `for = "/*"`; the only path pattern the site uses. */
  headers: Record<string, string>;
}

export function parseNetlifyToml(text: string): NetlifyConfig {
  const redirects: Redirect[] = [];
  const headers: Record<string, string> = {};
  let section = '';
  let current: Record<string, string> = {};
  let headerFor = '';
  const flush = () => {
    if (section === 'redirects' && current.from && current.to) {
      redirects.push({ from: current.from, to: current.to, status: Number(current.status ?? 301) });
    }
    current = {};
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const table = line.match(/^\[\[?([\w.]+)\]\]?$/);
    if (table) {
      const name = table[1] as string;
      if (name === 'headers.values') {
        section = headerFor === '/*' ? 'headerValues' : 'skip';
        continue;
      }
      flush();
      section = name;
      if (name === 'headers') headerFor = '';
      continue;
    }
    const kv = line.match(/^([\w-]+)\s*=\s*(?:"([^"]*)"|(\d+))\s*(?:#.*)?$/);
    if (!kv) continue;
    const key = kv[1] as string;
    const value = kv[2] ?? (kv[3] as string);
    if (section === 'headers' && key === 'for') headerFor = value;
    else if (section === 'headerValues') headers[key] = value;
    else current[key] = value;
  }
  flush();
  return { redirects, headers };
}

/** The canonical CTA targets: where `/install` and `/github` redirect to. */
export function canonicalUrls(config: NetlifyConfig): { install: string; github: string } {
  const to = (from: string) => {
    const r = config.redirects.find((x) => x.from === from);
    if (!r) throw new Error(`netlify.toml has no ${from} redirect`);
    return r.to;
  };
  return { install: to('/install'), github: to('/github') };
}
