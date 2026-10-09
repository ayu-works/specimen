import 'fake-indexeddb/auto';
import { type DesignScan, migrate } from '@specimen/core/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import {
  db,
  deleteScans,
  listScans,
  loadChat,
  saveChat,
  saveScan,
  thumbBlobs,
  updateScan,
} from '../src/lib/db';
import { buildExport, importFile, MAX_IMPORT_BYTES } from '../src/lib/libraryIO';

const PIXEL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const scanOf = (id: string, over: Partial<DesignScan> = {}): DesignScan => ({
  ...sampleScan,
  id,
  scannedAt: Date.now(),
  ...over,
});

const fileOf = (text: string, name = 'lib.specimen.json') => new File([text], name);

beforeEach(async () => {
  await Promise.all([db.scans.clear(), db.thumbs.clear(), db.chats.clear(), db.composes.clear()]);
});

describe('Library db (fake-indexeddb)', () => {
  it('T4.01 saves, reads, lists (newest first), updates and deletes scans', async () => {
    await saveScan(scanOf('a', { scannedAt: 1000, host: 'a.test' }), null);
    await saveScan(scanOf('b', { scannedAt: 3000, host: 'b.test' }), null, { tags: ['dark'] });
    await saveScan(scanOf('c', { scannedAt: 2000, host: 'c.test' }), null);

    expect((await db.scans.get('b'))?.host).toBe('b.test');
    const list = await listScans();
    expect(list.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(list[0]?.tags).toEqual(['dark']);
    expect(list[1]?.tags).toEqual([]);

    await updateScan('a', { title: 'Renamed', tags: ['x'], favorite: true });
    const a = (await listScans()).find((s) => s.id === 'a');
    expect(a).toMatchObject({ title: 'Renamed', tags: ['x'], favorite: true });

    await saveChat('a', [{ role: 'user', content: 'hi' }]);
    expect(await loadChat('a')).toHaveLength(1);
    await deleteScans(['a', 'c']);
    expect((await listScans()).map((s) => s.id)).toEqual(['b']);
    expect(await db.chats.get('a')).toBeUndefined();
  });

  it('T4.01 thumbnails live in their own table, not inside the scan row', async () => {
    await saveScan(scanOf('t1'), PIXEL);
    await saveScan(scanOf('t2'), null);

    const row = await db.scans.get('t1');
    expect(JSON.stringify(row)).not.toContain('data:image');
    const thumbs = await thumbBlobs();
    expect([...thumbs.keys()]).toEqual(['t1']);
    const blob = thumbs.get('t1') as Blob;
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBeGreaterThan(50);
    expect((await blob.arrayBuffer()).byteLength).toBe(blob.size);

    await deleteScans(['t1']);
    expect((await thumbBlobs()).size).toBe(0);
  });

  it('T4.01 rows that no longer validate are skipped, not fatal', async () => {
    await saveScan(scanOf('ok'), null);
    await db.scans.put({ id: 'broken', scannedAt: 1, tags: [] } as never);
    expect((await listScans()).map((s) => s.id)).toEqual(['ok']);
  });
});

describe('Library import / export', () => {
  it('T4.02 export then import round-trips the scans identically', async () => {
    const originals = [
      scanOf('r1', { scannedAt: 1000, host: 'one.test' }),
      scanOf('r2', { scannedAt: 2000, host: 'two.test' }),
    ];
    for (const s of originals) await saveScan(s, PIXEL, { tags: ['keep'] });
    const exported = buildExport(await listScans());
    const doc = JSON.parse(exported);
    expect(doc).toMatchObject({ format: 'specimen', version: 1 });
    // Library-only fields and thumbnails are never exported.
    expect(exported).not.toContain('"tags"');
    expect(exported).not.toContain('data:image');

    await Promise.all([db.scans.clear(), db.thumbs.clear()]);
    const res = await importFile(fileOf(exported));
    expect(res).toEqual({ imported: 2, skipped: 0 });

    const back = (await listScans()).map(({ tags: _t, favorite: _f, ...scan }) => scan);
    expect(back).toEqual(originals.map((s) => migrate(s)).reverse());
  });

  it('T4.02 importing an id that already exists keeps both copies', async () => {
    await saveScan(scanOf('dup'), null);
    const file = fileOf(buildExport([scanOf('dup')]));
    expect(await importFile(file)).toEqual({ imported: 1, skipped: 0 });
    const ids = (await listScans()).map((s) => s.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('T4.02 import runs schema migrations on older scans', async () => {
    const old = { ...scanOf('old'), schemaVersion: 1 };
    const file = fileOf(JSON.stringify({ format: 'specimen', version: 1, scans: [old] }));
    expect(await importFile(file)).toEqual({ imported: 1, skipped: 0 });
    expect((await db.scans.get('old'))?.schemaVersion).toBe(3);
    // A scan from a newer Specimen is skipped (and reported) rather than half-imported.
    const future = { ...scanOf('future'), schemaVersion: 99 };
    const mixed = fileOf(
      JSON.stringify({ format: 'specimen', version: 1, scans: [scanOf('fine'), future] }),
    );
    expect(await importFile(mixed)).toEqual({ imported: 1, skipped: 1 });
    expect(await db.scans.get('future')).toBeUndefined();
  });

  it('T4.03 rejects files that are not JSON', async () => {
    await expect(importFile(fileOf('this is not json {'))).rejects.toThrow(/not valid JSON/);
  });

  it('T4.03 rejects JSON that is not a Specimen export', async () => {
    for (const body of [
      '[]',
      '{"scans":[]}',
      '{"format":"other","version":1,"scans":[]}',
      'null',
    ]) {
      await expect(importFile(fileOf(body)), body).rejects.toThrow(/does not look like a Specimen/);
    }
  });

  it('T4.03 rejects an export with no valid scans and stores nothing', async () => {
    const body = JSON.stringify({ format: 'specimen', version: 1, scans: [{ nope: true }, 5] });
    await expect(importFile(fileOf(body))).rejects.toThrow(/No valid scans/);
    expect(await db.scans.count()).toBe(0);
  });

  it('T4.03 rejects oversized files before reading them', async () => {
    const big = { size: MAX_IMPORT_BYTES + 1, text: () => Promise.reject(new Error('read')) };
    await expect(importFile(big as unknown as File)).rejects.toThrow(/larger than 20 MB/);
  });
});
