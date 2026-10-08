import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** `~/.specimen`, or `$SPECIMEN_HOME` (used by tooling to keep a throwaway state dir). */
export function homeDir(): string {
  return process.env.SPECIMEN_HOME || join(homedir(), '.specimen');
}

export function scansDir(): string {
  return join(homeDir(), 'scans');
}

function configPath(): string {
  return join(homeDir(), 'config.json');
}

/** Create a private (0700) directory, tightening the mode if it already exists. */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* not our directory to chmod (e.g. read-only); the file modes still protect the contents */
  }
}

/** Write `data` to `path` with mode 0600, atomically (temp file then rename). */
export function writePrivateFile(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

interface Config {
  token: string;
}

function readConfig(): Config | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    const c = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
    return typeof c.token === 'string' && c.token.length >= 32 ? { token: c.token } : null;
  } catch {
    return null;
  }
}

/** The pairing token: 32 random bytes (base64url), generated on first use and kept at 0600. */
export function loadOrCreateToken(): string {
  const existing = readConfig();
  if (existing) {
    try {
      chmodSync(configPath(), 0o600);
    } catch {
      /* best effort */
    }
    return existing.token;
  }
  ensurePrivateDir(homeDir());
  const token = randomBytes(32).toString('base64url');
  writePrivateFile(configPath(), `${JSON.stringify({ token }, null, 2)}\n`);
  return token;
}

export function resolvePort(flag: string | undefined): number {
  const raw = flag ?? process.env.SPECIMEN_PORT;
  if (raw === undefined || raw === '') return 7457;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return n;
}
