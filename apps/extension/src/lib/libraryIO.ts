/** `.specimen.json` export / import (ARCHITECTURE §9). Thumbnails are never exported. */
import { filterCssVariables } from '@specimen/core';
import { BOUNDS, type DesignScan, migrate } from '@specimen/core/schema';
import { importScans, libraryErrorText } from './db';

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
  /** Already in the Library (same id and content), so not stored again. */
  duplicates: number;
  skipped: number;
}

/**
 * Validate and store an imported file: every valid scan or none. Importing the same file again
 * (say after a failure) adds nothing twice. Throws an Error with a user-readable message.
 */
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
  if (Number.isInteger(doc.version) && doc.version > 1)
    throw new Error('That file is from a newer Specimen. Update Specimen and try again.');
  if (doc.version !== 1) throw new Error('That does not look like a Specimen export.');
  const rawScans: unknown[] = doc.scans;
  if (rawScans.length > BOUNDS.importScans)
    throw new Error(
      `That file has ${rawScans.length} scans; Specimen imports at most ${BOUNDS.importScans} at a time.`,
    );
  const valid: DesignScan[] = [];
  for (const raw of rawScans) {
    try {
      const scan = migrate(raw);
      // A shared file carries no more CSS variables than a (merged) live scan would keep.
      valid.push({
        ...scan,
        cssVariables: filterCssVariables(scan.cssVariables, BOUNDS.cssVariables),
      });
    } catch {
      /* counted as skipped */
    }
  }
  if (valid.length === 0) throw new Error('No valid scans were found in that file.');
  let written: Awaited<ReturnType<typeof importScans>>;
  try {
    written = await importScans(valid);
  } catch (e) {
    throw new Error(`Import failed, nothing was saved: ${libraryErrorText(e)}.`);
  }
  return { ...written, skipped: rawScans.length - valid.length };
}
