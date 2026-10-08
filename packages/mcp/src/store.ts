import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { type DesignScan, migrate } from '@specimen/core';
import { ensurePrivateDir, scansDir, writePrivateFile } from './config';

/** Scan ids come from the extension (UUIDs). Anything else is refused: no path tricks. */
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export interface StoredEntry {
  scan: DesignScan;
  tags: string[];
}

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

function fileFor(id: string): string {
  return join(scansDir(), `${id}.json`);
}

/** Validate with `migrate()` then upsert to disk. Throws when the scan is invalid. */
export function saveScan(raw: unknown, tags: unknown): DesignScan {
  const scan = migrate(raw);
  if (!isValidId(scan.id)) throw new Error('invalid scan id');
  const cleanTags = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === 'string').slice(0, 50)
    : [];
  ensurePrivateDir(scansDir());
  writePrivateFile(fileFor(scan.id), JSON.stringify({ ...scan, tags: cleanTags }));
  return scan;
}

export function deleteScan(id: string): void {
  if (!isValidId(id)) return;
  try {
    unlinkSync(fileFor(id));
  } catch {
    /* already gone */
  }
}

function readEntry(path: string): StoredEntry | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { tags?: unknown };
    const tags = Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [];
    return { scan: migrate(raw), tags };
  } catch {
    return null;
  }
}

export function getEntry(id: string): StoredEntry | null {
  return isValidId(id) ? readEntry(fileFor(id)) : null;
}

/** All stored scans, newest first. Unreadable or invalid files are skipped. */
export function listEntries(): StoredEntry[] {
  let names: string[];
  try {
    names = readdirSync(scansDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: StoredEntry[] = [];
  for (const name of names) {
    const e = readEntry(join(scansDir(), name));
    if (e) out.push(e);
  }
  return out.sort((a, b) => b.scan.scannedAt - a.scan.scannedAt);
}

export function countEntries(): number {
  try {
    return readdirSync(scansDir()).filter((n) => n.endsWith('.json')).length;
  } catch {
    return 0;
  }
}
