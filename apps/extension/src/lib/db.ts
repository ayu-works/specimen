/**
 * Local library (ARCHITECTURE §9): IndexedDB via Dexie, db `specimen`.
 * Everything stays on the device; scans are re-validated through `migrate()` on every read.
 */
import { type DesignScan, DesignScanSchema, migrate } from '@specimen/core/schema';
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

/** Save a scan (new row every time) and its thumbnail. Returns the stored row. */
export async function saveScan(
  scan: DesignScan,
  screenshot: string | null,
  extra: { tags?: string[] } = {},
): Promise<StoredScan> {
  DesignScanSchema.parse(scan);
  const row: StoredScan = { ...scan, tags: extra.tags ?? [] };
  await db.scans.put(row);
  const blob = screenshot ? dataUrlToBlob(screenshot) : null;
  if (blob) await db.thumbs.put({ scanId: scan.id, blob });
  return row;
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

export async function updateScan(
  id: string,
  patch: Partial<Pick<StoredScan, 'title' | 'tags' | 'favorite' | 'vibe' | 'variants'>>,
): Promise<void> {
  if (!patch.variants) {
    await db.scans.update(id, patch);
    return;
  }
  // Variants carry palettes and role ids: check the merged row, so a bad patch fails here and
  // not later as a scan that no longer reads back.
  await db.transaction('rw', db.scans, async () => {
    const row = await db.scans.get(id);
    if (!row) return;
    // The stored row may be older (repaired on read); the patch itself must meet the current schema.
    DesignScanSchema.parse({ ...migrate(row), ...patch });
    await db.scans.put({ ...row, ...patch });
  });
}

/** Replace a stored scan's data in place (merge, re-capture), keeping its tags and favorite. */
export async function replaceStoredScan(scan: DesignScan): Promise<void> {
  DesignScanSchema.parse(scan);
  const old = await db.scans.get(scan.id);
  await db.scans.put({ ...scan, tags: old?.tags ?? [], favorite: old?.favorite });
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
  DesignScanSchema.parse(composed);
  await db.transaction('rw', db.scans, db.composes, async () => {
    await db.composes.put(row);
    await db.scans.put({ ...composed, tags: ['composed'] });
  });
}
