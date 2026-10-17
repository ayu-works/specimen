import 'fake-indexeddb/auto';
import { generateDesignMd, generatePrompt } from '@specimen/core';
import { type DesignScan, migrate, SCHEMA_VERSION } from '@specimen/core/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sampleScan } from '../src/entrypoints/sidepanel/dev/sampleScan';
import {
  db,
  deleteScans,
  listScans,
  loadChat,
  replaceStoredScan,
  saveChat,
  saveCompose,
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
const exportOf = (scans: unknown[], version: unknown = 1) =>
  fileOf(JSON.stringify({ format: 'specimen', version, scans }));

/** Fail the n-th new row of a table (the real IndexedDB transaction aborts), until `heal()`. */
function failNth(table: typeof db.scans | typeof db.thumbs, n: number, err: () => Error) {
  let seen = 0;
  const hook = () => {
    if (++seen === n) throw err();
  };
  table.hook('creating', hook as never);
  const heal = () => table.hook('creating').unsubscribe(hook as never);
  heals.push(heal);
  return heal;
}
const heals: (() => void)[] = [];
afterEach(() => {
  for (const heal of heals.splice(0)) heal();
});

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

describe('Library db: stored rows from older builds', () => {
  it('T4.01 a stored v3 row with an unreadable color still lists, repaired, and generates', async () => {
    const row = scanOf('legacy');
    const first = row.colors.palette[0];
    if (!first) throw new Error('sample scan has no palette');
    const old = {
      ...row,
      schemaVersion: 3,
      colors: {
        ...row.colors,
        palette: row.colors.palette.map((t) => (t.id === first.id ? { ...t, hex: 'nope' } : t)),
      },
      tags: [],
    };
    await db.scans.put(old as unknown as Parameters<typeof db.scans.put>[0]);
    const listed = (await listScans()).find((s) => s.id === 'legacy');
    expect(listed).toBeDefined();
    if (!listed) return;
    expect(listed.colors.palette.map((t) => t.id)).not.toContain(first.id);
    expect(Object.values(listed.colors.roles)).not.toContain(first.id);
    expect(() => generatePrompt(listed)).not.toThrow();
    // Reads don't write back: the stored row is untouched, and a second read gives the same result.
    expect((await db.scans.get('legacy'))?.schemaVersion).toBe(3);
    expect((await listScans()).find((s) => s.id === 'legacy')).toEqual(listed);
  });
});

describe('Library db: writes are validated (lens B B3)', () => {
  it('T4.01 a write that breaks the schema rejects and leaves the stored row as it was', async () => {
    const badHex = scanOf('bad');
    badHex.colors = {
      ...badHex.colors,
      palette: badHex.colors.palette.map((t, i) => (i === 0 ? { ...t, hex: 'zzz' } : t)),
    };
    await expect(saveScan(badHex, null)).rejects.toThrow();
    expect(await db.scans.get('bad')).toBeUndefined();
    await expect(replaceStoredScan(badHex)).rejects.toThrow();
    expect(await db.scans.get('bad')).toBeUndefined();

    await saveScan(scanOf('keep'), null);
    const dark = { roles: { background: 'no-such-id' } };
    await expect(updateScan('keep', { variants: { dark } })).rejects.toThrow();
    const listed = (await listScans()).find((s) => s.id === 'keep');
    expect(listed?.variants?.dark?.roles).toBeUndefined();
    // A valid patch still goes through.
    await updateScan('keep', { title: 'Renamed' });
    expect((await listScans()).find((s) => s.id === 'keep')?.title).toBe('Renamed');
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
    expect(res).toEqual({ imported: 2, duplicates: 0, skipped: 0 });

    const back = (await listScans()).map(({ tags: _t, favorite: _f, ...scan }) => scan);
    expect(back).toEqual(originals.map((s) => migrate(s)).reverse());
  });

  it('T4.02 an existing id with other content keeps both copies; the same content is not stored twice', async () => {
    await saveScan(scanOf('dup', { scannedAt: 1000 }), null);
    const same = fileOf(buildExport([scanOf('dup', { scannedAt: 1000 })]));
    expect(await importFile(same)).toEqual({ imported: 0, duplicates: 1, skipped: 0 });
    expect(await db.scans.count()).toBe(1);

    const other = fileOf(buildExport([scanOf('dup', { scannedAt: 2000 })]));
    expect(await importFile(other)).toEqual({ imported: 1, duplicates: 0, skipped: 0 });
    const ids = (await listScans()).map((s) => s.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // Importing that file again finds the copy under its new id instead of adding a third.
    expect(await importFile(other)).toEqual({ imported: 0, duplicates: 1, skipped: 0 });
    expect(await db.scans.count()).toBe(2);
  });

  it('T4.02 import runs schema migrations on older scans', async () => {
    const old = { ...scanOf('old'), schemaVersion: 1 };
    const file = fileOf(JSON.stringify({ format: 'specimen', version: 1, scans: [old] }));
    expect(await importFile(file)).toEqual({ imported: 1, duplicates: 0, skipped: 0 });
    expect((await db.scans.get('old'))?.schemaVersion).toBe(SCHEMA_VERSION);
    // A scan from a newer Specimen is skipped (and reported) rather than half-imported.
    const future = { ...scanOf('future'), schemaVersion: 99 };
    const mixed = fileOf(
      JSON.stringify({ format: 'specimen', version: 1, scans: [scanOf('fine'), future] }),
    );
    expect(await importFile(mixed)).toEqual({ imported: 1, duplicates: 0, skipped: 1 });
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

  it('T4.03 a v4 scan with a non-hex color or a dangling role is skipped; an older one is repaired', async () => {
    const badHex = scanOf('bad-hex');
    badHex.colors = {
      ...badHex.colors,
      palette: badHex.colors.palette.map((t, i) => (i === 0 ? { ...t, hex: 'zzz' } : t)),
    };
    const dangling = scanOf('dangling');
    dangling.colors = { ...dangling.colors, roles: { ...dangling.colors.roles, link: 'nope' } };
    const oldBad = { ...structuredClone(badHex), id: 'old-bad', schemaVersion: 3 };
    const file = fileOf(
      JSON.stringify({
        format: 'specimen',
        version: 1,
        scans: [scanOf('fine'), badHex, dangling, oldBad],
      }),
    );
    expect(await importFile(file)).toEqual({ imported: 2, duplicates: 0, skipped: 2 });
    expect(await db.scans.get('bad-hex')).toBeUndefined();
    expect(await db.scans.get('dangling')).toBeUndefined();

    // The v3 row was repaired on import: the unreadable color and its roles are gone, Generate works.
    const repaired = (await listScans()).find((s) => s.id === 'old-bad');
    expect(repaired?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(repaired?.colors.palette.some((t) => t.hex === 'zzz')).toBe(false);
    expect(repaired?.meta.warnings.filter((w) => w.startsWith('Repaired on upgrade'))).toHaveLength(
      1,
    );
    if (!repaired) return;
    expect(() => generatePrompt(repaired)).not.toThrow();
    expect(() => generateDesignMd(repaired)).not.toThrow();
  });

  it('T4.03 rejects oversized files before reading them', async () => {
    const big = { size: MAX_IMPORT_BYTES + 1, text: () => Promise.reject(new Error('read')) };
    await expect(importFile(big as unknown as File)).rejects.toThrow(/larger than 20 MB/);
  });
});

describe('Library writes are atomic and idempotent (audit H6, M14)', () => {
  const three = () => [
    scanOf('i1', { scannedAt: 1 }),
    scanOf('i2', { scannedAt: 2 }),
    scanOf('i3', { scannedAt: 3 }),
  ];

  it('T4.03 a failed 2nd write stores nothing; the retry stores each scan once; a 3rd import adds nothing', async () => {
    const file = () => fileOf(buildExport(three()));
    const heal = failNth(db.scans, 2, () => new Error('disk said no'));
    await expect(importFile(file())).rejects.toThrow(
      /Import failed, nothing was saved: disk said no/,
    );
    expect(await db.scans.count()).toBe(0);

    heal();
    expect(await importFile(file())).toEqual({ imported: 3, duplicates: 0, skipped: 0 });
    expect((await listScans()).map((s) => s.id).sort()).toEqual(['i1', 'i2', 'i3']);
    expect(await importFile(file())).toEqual({ imported: 0, duplicates: 3, skipped: 0 });
    expect(await db.scans.count()).toBe(3);
  });

  it('T4.03 a full disk names the cause and stores nothing', async () => {
    failNth(db.scans, 1, () => new DOMException('quota', 'QuotaExceededError'));
    await expect(importFile(fileOf(buildExport(three())))).rejects.toThrow(
      /nothing was saved: your browser is out of storage space/,
    );
    expect(await db.scans.count()).toBe(0);
  });

  it('T4.03 only export format version 1 is accepted', async () => {
    await expect(importFile(exportOf([scanOf('v')], 2))).rejects.toThrow(/newer Specimen/);
    for (const v of [0, 1.5, -1, '1']) {
      await expect(importFile(exportOf([scanOf('v')], v)), String(v)).rejects.toThrow(
        /does not look like a Specimen/,
      );
    }
    expect(await db.scans.count()).toBe(0);
  });

  it('T4.03 duplicate ids inside one file: the same scan twice is stored once, different scans both', async () => {
    const a = scanOf('same', { scannedAt: 5 });
    expect(await importFile(exportOf([a, a]))).toEqual({ imported: 1, duplicates: 1, skipped: 0 });
    const b = scanOf('same', { scannedAt: 6 });
    expect(await importFile(exportOf([b]))).toEqual({ imported: 1, duplicates: 0, skipped: 0 });
    expect(await db.scans.count()).toBe(2);
    expect(new Set((await listScans()).map((s) => s.id)).size).toBe(2);
  });

  it('T4.03 a file with more than 500 scans is rejected whole (sec M2)', async () => {
    const many = Array.from({ length: 501 }, (_, i) => scanOf(`m${i}`, { scannedAt: i }));
    await expect(importFile(exportOf(many))).rejects.toThrow(/501 scans.*at most 500/);
    expect(await db.scans.count()).toBe(0);
    expect(await importFile(exportOf(many.slice(0, 500)))).toMatchObject({ imported: 500 });
  });

  it('T4.03 an over-bound v5 scan is skipped; a v4 one is imported trimmed (sec M2)', async () => {
    const huge = scanOf('huge5', { title: 'x'.repeat(5000) });
    const old = { ...scanOf('huge4', { title: 'x'.repeat(5000) }), schemaVersion: 4 };
    expect(await importFile(exportOf([huge, old]))).toEqual({
      imported: 1,
      duplicates: 0,
      skipped: 1,
    });
    expect((await db.scans.get('huge4'))?.title).toHaveLength(1000);
    expect(await db.scans.get('huge5')).toBeUndefined();
  });

  it('T4.03 a clashing id at the length bound still gets a valid id', async () => {
    const id = 'i'.repeat(1000);
    await saveScan(scanOf(id, { scannedAt: 1 }), null);
    expect(await importFile(exportOf([scanOf(id, { scannedAt: 2 })]))).toMatchObject({
      imported: 1,
    });
    expect((await listScans()).map((s) => s.id.length)).toEqual([1000, 1000]);
  });

  it('T4.03 imported CSS variables go through the extractor filter (sec L2)', async () => {
    const s = scanOf('vars', {
      cssVariables: { constructor: 'x', '--brand': '#5e6ad2', '--color-x': '`'.repeat(300) },
    });
    await importFile(exportOf([s]));
    expect((await db.scans.get('vars'))?.cssVariables).toEqual({ '--brand': '#5e6ad2' });
  });

  it('T4.01 a failed thumbnail write leaves neither the scan nor the thumbnail', async () => {
    failNth(db.thumbs, 1, () => new Error('thumb write failed'));
    await expect(saveScan(scanOf('pic'), PIXEL)).rejects.toThrow();
    expect(await db.scans.get('pic')).toBeUndefined();
    expect((await thumbBlobs()).size).toBe(0);
  });

  it('T4.01 an unreadable screenshot saves the scan without a thumbnail', async () => {
    await saveScan(scanOf('nopic'), 'data:image/jpeg;base64,%%%not-base64');
    expect(await db.scans.get('nopic')).toBeDefined();
    expect((await thumbBlobs()).size).toBe(0);
  });
});

describe('Library writers store the parsed scan (sec L3)', () => {
  const junk = (id: string) => ({ ...scanOf(id), payload: 'x'.repeat(10) }) as DesignScan;

  it('T4.01 unknown keys never reach IndexedDB through any writer', async () => {
    await saveScan(junk('w1'), null);
    await replaceStoredScan(junk('w2'));
    await saveCompose(
      {
        id: 'c',
        name: 'c',
        sources: { colors: 'a', typography: 'a', spacing: 'a', shape: 'a', layout: 'a' },
        createdAt: 1,
      },
      junk('w3'),
    );
    await db.scans.put({ ...junk('w4'), tags: [] });
    await updateScan('w4', { title: 'Renamed' });
    for (const id of ['w1', 'w2', 'w3', 'w4']) {
      expect(await db.scans.get(id), id).not.toHaveProperty('payload');
    }
    expect((await db.scans.get('w4'))?.title).toBe('Renamed');
  });

  it('T4.01 a tag or favourite edit keeps the other, and an update of a row that no longer reads fails', async () => {
    await saveScan(scanOf('t'), null, { tags: ['a'] });
    await updateScan('t', { favorite: true });
    expect(await db.scans.get('t')).toMatchObject({ tags: ['a'], favorite: true });
    await updateScan('t', { tags: ['b'] });
    expect(await db.scans.get('t')).toMatchObject({ tags: ['b'], favorite: true });

    await db.scans.put({ id: 'broken', scannedAt: 1, tags: [] } as never);
    await expect(updateScan('broken', { title: 'x' })).rejects.toThrow();
    expect(await db.scans.get('broken')).not.toHaveProperty('title');
  });
});
