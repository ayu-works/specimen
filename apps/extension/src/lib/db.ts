/**
 * Local library (ARCHITECTURE §9): IndexedDB via Dexie, db `specimen`.
 * Everything stays on the device; scans are re-validated through `migrate()` on every read.
 */
import { filterCssVariables } from '@specimen/core';
import { BOUNDS, type DesignScan, DesignScanSchema, migrate } from '@specimen/core/schema';
import Dexie, { type EntityTable } from 'dexie';

export interface StoredScan extends DesignScan {
  tags: string[];
  favorite?: boolean;
}

export interface ThumbRow {
  scanId: string;
  blob: Blob;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Friendly error text instead of an answer. */
  error?: string;
}

export interface ChatRow {
  scanId: string;
  messages: ChatMessage[];
}

export type ComposeFacet = 'colors' | 'typography' | 'spacing' | 'shape' | 'layout';

export interface ComposeRow {
  id: string;
  name: string;
  sources: Record<ComposeFacet, string>;
  createdAt: number;
}

class SpecimenDb extends Dexie {
  scans!: EntityTable<StoredScan, 'id'>;
  thumbs!: EntityTable<ThumbRow, 'scanId'>;
  chats!: EntityTable<ChatRow, 'scanId'>;
  composes!: EntityTable<ComposeRow, 'id'>;

  constructor() {
    super('specimen');
    this.version(1).stores({
      scans: '&id, host, url, title, scannedAt, *tags',
      thumbs: '&scanId',
      chats: '&scanId',
      composes: '&id, createdAt',
    });
  }
}

export const db = new SpecimenDb();

/** Library size above which we offer (once) to export and clean up. */
export const LIBRARY_SOFT_CAP = 500;

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] ?? 'image/jpeg';
  const raw = m[2] ? atob(m[3] ?? '') : decodeURIComponent(m[3] ?? '');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Save a scan (new row every time) and its thumbnail, both or neither. Returns the stored row. */
export async function saveScan(
  scan: DesignScan,
  screenshot: string | null,
  extra: { tags?: string[] } = {},
): Promise<StoredScan> {
  const row: StoredScan = { ...DesignScanSchema.parse(scan), tags: extra.tags ?? [] };
  // Decode before the transaction: awaiting anything but Dexie inside it would commit it early.
  let blob: Blob | null = null;
  try {
    blob = screenshot ? dataUrlToBlob(screenshot) : null;
  } catch {
    /* an unreadable screenshot just means no thumbnail */
  }
  await db.transaction('rw', db.scans, db.thumbs, async () => {
    await db.scans.put(row);
    if (blob) await db.thumbs.put({ scanId: row.id, blob });
  });
  return row;
}

/** A Library write error as a short, user-readable reason. */
export function libraryErrorText(e: unknown): string {
  const err = e as { name?: string; message?: string; inner?: { name?: string } } | null;
  const names = [err?.name, err?.inner?.name];
  if (names.includes('QuotaExceededError')) return 'your browser is out of storage space';
  if (err?.name === 'ZodError') return "the scan didn't pass validation";
  if (
    names.some(
      (n) => n === 'InvalidStateError' || n === 'DatabaseClosedError' || n === 'OpenFailedError',
    )
  )
    return 'browser storage is unavailable here (a private window?)';
  return err?.message || 'browser storage failed';
}

function toStored(row: StoredScan): StoredScan | null {
  try {
    return {
      ...migrate(row),
      tags: Array.isArray(row.tags) ? row.tags : [],
      favorite: row.favorite,
    };
  } catch {
    return null;
  }
}

/** All scans, newest first. Rows that no longer validate are skipped. */
export async function listScans(): Promise<StoredScan[]> {
  const rows = await db.scans.orderBy('scannedAt').reverse().toArray();
  return rows.flatMap((r) => {
    const s = toStored(r);
    return s ? [s] : [];
  });
}

/** One saved scan by id, or null when it is gone or no longer validates. */
export async function getStoredScan(id: string): Promise<StoredScan | null> {
  const row = await db.scans.get(id);
  return row ? toStored(row) : null;
}

/** Saved scans of one host, newest first. Rows that no longer validate are skipped. */
export async function scansForHost(host: string): Promise<StoredScan[]> {
  const rows = await db.scans.where('host').equals(host).toArray();
  return rows
    .sort((a, b) => b.scannedAt - a.scannedAt)
    .flatMap((r) => {
      const s = toStored(r);
      return s ? [s] : [];
    });
}

/** The newest saved scan, or null. */
export async function latestScan(): Promise<StoredScan | null> {
  const row = await db.scans.orderBy('scannedAt').last();
  return row ? toStored(row) : null;
}

export async function countScans(): Promise<number> {
  return db.scans.count();
}

/** Patch a stored scan. The merged row must meet the current schema, or nothing is written. */
export async function updateScan(
  id: string,
  patch: Partial<Pick<StoredScan, 'title' | 'tags' | 'favorite' | 'vibe' | 'variants'>>,
): Promise<void> {
  const { tags, favorite, ...data } = patch;
  await db.transaction('rw', db.scans, async () => {
    const row = await db.scans.get(id);
    if (!row) return;
    // The stored row may be older (repaired on read); the patched result must meet the current schema.
    const clean = DesignScanSchema.parse({ ...migrate(row), ...data });
    await db.scans.put({
      ...clean,
      tags: tags ?? (Array.isArray(row.tags) ? row.tags : []),
      favorite: 'favorite' in patch ? favorite : row.favorite,
    });
  });
}

/** Replace a stored scan's data in place (merge, re-capture), keeping its tags and favorite. */
export async function replaceStoredScan(scan: DesignScan): Promise<void> {
  const clean = DesignScanSchema.parse(scan);
  await db.transaction('rw', db.scans, async () => {
    const old = await db.scans.get(clean.id);
    await db.scans.put({ ...clean, tags: old?.tags ?? [], favorite: old?.favorite });
  });
}

/** JSON with sorted keys, so equal scans compare equal whatever their key order. */
function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, (x as Record<string, unknown>)[k]]),
        )
      : x,
  );
}

/** A scan's content (everything but its id) as a comparable string. */
function contentKey(scan: DesignScan): string {
  const { id: _id, ...rest } = scan;
  return stableJson(rest);
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 6), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export interface ImportWrite {
  imported: number;
  /** Scans already in the Library with the same id and content (or repeated in the file). */
  duplicates: number;
}

/**
 * Store imported scans in one transaction: all of them or none. Idempotent: a scan whose id and
 * content are already stored is not written again. A clashing id with other content is stored
 * under an id derived from its content, so a retry finds it there instead of adding a copy.
 */
export async function importScans(scans: DesignScan[]): Promise<ImportWrite> {
  const items = await Promise.all(
    scans.map(async (s) => {
      const clean = DesignScanSchema.parse(s);
      const key = contentKey(clean);
      // `-` + 12 hex chars; the id stays inside its bound.
      const altId = `${clean.id.slice(0, BOUNDS.text - 13)}-${await shortHash(key)}`;
      return { clean, key, altId };
    }),
  );
  return db.transaction('rw', db.scans, async () => {
    const ids = [...new Set(items.flatMap((i) => [i.clean.id, i.altId]))];
    const stored = await db.scans.bulkGet(ids);
    /** id → content key (null = a stored row that no longer reads), for rows stored or about to be. */
    const taken = new Map<string, string | null>();
    for (const row of stored) {
      if (!row) continue;
      let key: string | null = null;
      try {
        // Compared as an import would store it: rows imported before the filter keep extra variables.
        const s = migrate(row);
        key = contentKey({ ...s, cssVariables: filterCssVariables(s.cssVariables) });
      } catch {
        /* unreadable: its id is taken, its content matches nothing */
      }
      taken.set(row.id, key);
    }
    const rows: StoredScan[] = [];
    let duplicates = 0;
    for (const { clean, key, altId } of items) {
      const candidates = [clean.id, altId];
      if (candidates.some((c) => taken.get(c) === key)) {
        duplicates++;
        continue;
      }
      const id = candidates.find((c) => !taken.has(c)) ?? crypto.randomUUID();
      const row = { ...clean, id, tags: [] };
      taken.set(row.id, key);
      rows.push(row);
    }
    await db.scans.bulkAdd(rows);
    return { imported: rows.length, duplicates };
  });
}

export async function deleteScans(ids: string[]): Promise<void> {
  await db.transaction('rw', db.scans, db.thumbs, db.chats, async () => {
    await db.scans.bulkDelete(ids);
    await db.thumbs.bulkDelete(ids);
    await db.chats.bulkDelete(ids);
  });
}

/** A saved scan's thumbnail as a data URL (for vision models), or null. */
export async function thumbDataUrl(scanId: string): Promise<string | null> {
  const row = await db.thumbs.get(scanId);
  if (!row) return null;
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(row.blob);
  });
}

export async function thumbBlobs(): Promise<Map<string, Blob>> {
  const rows = await db.thumbs.toArray();
  return new Map(rows.map((r) => [r.scanId, r.blob]));
}

/** Settles when the one-time chat scrub (lib/chatScrub.ts) is over; chat text waits for it. */
let chatsReady: Promise<unknown> = Promise.resolve();

/** Hold every read and write of chat text until `work` settles (it never rejects the readers). */
export function whenChatsReady(work: Promise<unknown>): void {
  chatsReady = work.catch(() => {});
}

export async function loadChat(scanId: string): Promise<ChatMessage[]> {
  await chatsReady;
  try {
    return (await db.chats.get(scanId))?.messages ?? [];
  } catch {
    return [];
  }
}

export async function saveChat(scanId: string, messages: ChatMessage[]): Promise<void> {
  await chatsReady;
  try {
    // Only persist scans that live in the library.
    if (!(await db.scans.get(scanId))) return;
    await db.chats.put({ scanId, messages });
  } catch {
    /* storage unavailable: the transcript just stays in memory */
  }
}

export async function saveCompose(row: ComposeRow, composed: DesignScan): Promise<void> {
  const clean = DesignScanSchema.parse(composed);
  await db.transaction('rw', db.scans, db.composes, async () => {
    await db.composes.put(row);
    await db.scans.put({ ...clean, tags: ['composed'] });
  });
}
