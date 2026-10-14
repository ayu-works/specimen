/**
 * Council runs (SPC-24): a separate IndexedDB database `specimen-council`, so the main `specimen`
 * DB (scans, chats) never needs a version bump for it. The offscreen host writes a record once per
 * turn end and per status change; panels and the service worker only mark dead runs
 * `interrupted`, conditionally. Holds no key.
 */
import Dexie, { type EntityTable } from 'dexie';
import type { CouncilRecord } from './councilProtocol';

/** How many runs to keep; older ones are pruned in the same transaction as each write. */
export const KEEP_RUNS = 5;

class CouncilDb extends Dexie {
  runs!: EntityTable<CouncilRecord, 'runId'>;
  constructor() {
    super('specimen-council');
    this.version(1).stores({ runs: '&runId, startedAt, status' });
  }
}

let db: CouncilDb | null = null;
const getDb = (): CouncilDb => {
  db ??= new CouncilDb();
  return db;
};

/** Write one record and prune to the newest `KEEP_RUNS`, atomically. */
export async function putRun(rec: CouncilRecord): Promise<void> {
  const d = getDb();
  await d.transaction('rw', d.runs, async () => {
    await d.runs.put(rec);
    const old = await d.runs.orderBy('startedAt').reverse().offset(KEEP_RUNS).primaryKeys();
    if (old.length) await d.runs.bulkDelete(old);
  });
}

/** The most recently started run, or null. */
export async function latestRun(): Promise<CouncilRecord | null> {
  return (await getDb().runs.orderBy('startedAt').last()) ?? null;
}

export async function getRun(runId: string): Promise<CouncilRecord | null> {
  return (await getDb().runs.get(runId)) ?? null;
}

export async function countRuns(): Promise<number> {
  return getDb().runs.count();
}

/**
 * Mark a run `interrupted` only if it is still the `running` record we saw (same `updatedAt`),
 * so a live host that just wrote a turn is never overwritten. Returns the new record, or null.
 */
export async function markInterrupted(
  runId: string,
  updatedAt: number,
  now = Date.now(),
): Promise<CouncilRecord | null> {
  const d = getDb();
  return d.transaction('rw', d.runs, async () => {
    const cur = await d.runs.get(runId);
    if (cur?.status !== 'running' || cur.updatedAt !== updatedAt) return null;
    const next: CouncilRecord = { ...cur, status: 'interrupted', updatedAt: now };
    await d.runs.put(next);
    return next;
  });
}

/**
 * Store a finished run a panel got from the host's memory, but only over a copy that still says
 * `running` (the host's own final write failed). Never overwrites a finished record.
 */
export async function saveIfStillRunning(rec: CouncilRecord): Promise<void> {
  if (rec.status === 'running') return;
  const d = getDb();
  await d.transaction('rw', d.runs, async () => {
    const cur = await d.runs.get(rec.runId);
    if (cur?.status === 'running') await d.runs.put(rec);
  });
}

/** Browser start or extension install/update: no offscreen run can have survived. */
export async function interruptAllRunning(now = Date.now()): Promise<number> {
  const d = getDb();
  return d.runs
    .where('status')
    .equals('running')
    .modify((r) => {
      r.status = 'interrupted';
      r.updatedAt = now;
    });
}

/** Forget every run (the Labs flag went off): the goal text and hosts don't stay on disk. */
export async function clearRuns(): Promise<void> {
  await getDb().runs.clear();
}

/** Tests only: drop the cached handle (fake-indexeddb is reset between tests). */
export async function _resetCouncilDb(): Promise<void> {
  if (db) {
    db.close();
    await Dexie.delete('specimen-council');
  }
  db = null;
}
