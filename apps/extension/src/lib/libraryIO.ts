/** `.specimen.json` export / import (ARCHITECTURE §9). Thumbnails are never exported. */
import { type DesignScan, migrate } from '@specimen/core/schema';
import { db, saveScan } from './db';

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export function buildExport(scans: DesignScan[]): string {
  const clean = scans.map(({ ...s }) => {
    const {
      tags: _t,
      favorite: _f,
      ...rest
    } = s as DesignScan & { tags?: unknown; favorite?: unknown };
    return rest;
  });
  return JSON.stringify({ format: 'specimen', version: 1, scans: clean }, null, 2);
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFilename(): string {
  return `specimen-library-${new Date().toISOString().slice(0, 10)}.specimen.json`;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/** Validate and store an imported file. Throws an Error with a user-readable message. */
export async function importFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('That file is larger than 20 MB.');
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const doc = json as { format?: unknown; version?: unknown; scans?: unknown } | null;
  if (doc?.format !== 'specimen' || typeof doc.version !== 'number' || !Array.isArray(doc.scans))
    throw new Error('That does not look like a Specimen export.');
  const rawScans: unknown[] = doc.scans;
  const valid: DesignScan[] = [];
  for (const raw of rawScans) {
    try {
      valid.push(migrate(raw));
    } catch {
      /* counted as skipped */
    }
  }
  if (valid.length === 0) throw new Error('No valid scans were found in that file.');
  const existing = new Set(await db.scans.toCollection().primaryKeys());
  for (const s of valid) {
    const scan = existing.has(s.id) ? { ...s, id: crypto.randomUUID() } : s;
    existing.add(scan.id);
    await saveScan(scan, null);
  }
  return { imported: valid.length, skipped: rawScans.length - valid.length };
}
