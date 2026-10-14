// Usage: tsx scripts/check-test-ids.ts --phase 0
//        tsx scripts/check-test-ids.ts --all     (every `## Phase <n>` in docs/TESTING.md; phases 0-7 must exist)
// Verifies every automated test ID of a phase in docs/TESTING.md appears as `'T<phase>.xx ...` in a
// *.test.ts(x) / *.spec.ts file. Manual (🖐) IDs are skipped; dropped (⊘) IDs are skipped and must NOT have a test.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Kind = 'auto' | 'manual' | 'dropped';
export interface Row {
  id: string;
  phase: string;
  kind: Kind;
}

const MANUAL = '🖐';
const DROPPED = '⊘';
const DROPPED_PREFIX = /^\*\*Dropped \d{4}-\d{2}-\d{2}\*\*/;
/** Phases the product has; `--all` fails if one is missing from TESTING.md. */
export const REQUIRED_PHASES = ['0', '1', '2', '3', '4', '5', '6', '7'];

/** Parses the ID tables. Throws on a malformed row, so a typo can't silently skip an ID. */
export function parseTestingMd(md: string): { phases: Set<string>; rows: Row[] } {
  const phases = new Set<string>();
  const rows: Row[] = [];
  const seen = new Set<string>();
  let phase: string | null = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+(?:Phase\s+(\d+)\b)?/);
    if (h) {
      phase = h[1] ?? null;
      if (phase) phases.add(phase);
      continue;
    }
    if (phase === null) continue;
    const row = line.match(/^\|\s*(T\d+\.\d+)\s*\|(.*)\|\s*$/);
    if (!row) continue;
    const id = row[1] as string;
    // cells: ['', id, (type,)? test, '']; a Type column exists only in some tables
    const content = line
      .split('|')
      .map((c) => c.trim())
      .slice(2, -1);
    const test = content.at(-1) ?? '';
    const types = content.slice(0, -1);
    const fail = (why: string) => {
      throw new Error(`docs/TESTING.md ${id}: ${why}`);
    };
    if (seen.has(id)) fail('duplicate ID');
    seen.add(id);
    if (test === MANUAL || test === DROPPED)
      fail(`${test} must be in a Type cell, not the Test cell`);
    const manual = types.includes(MANUAL);
    const dropped = types.includes(DROPPED);
    if (manual && dropped) fail(`marked both ${MANUAL} and ${DROPPED}`);
    if (dropped && !DROPPED_PREFIX.test(test))
      fail(`${DROPPED} row must start with **Dropped YYYY-MM-DD**`);
    if (!dropped && /^\*\*Dropped\b/.test(test)) fail(`"Dropped" row needs Type ${DROPPED}`);
    rows.push({ id, phase, kind: dropped ? 'dropped' : manual ? 'manual' : 'auto' });
  }
  return { phases, rows };
}

export type Selection =
  | { all: true; requiredPhases?: readonly string[] }
  | { all: false; phase: string };

const hasTest = (id: string, sources: string) =>
  new RegExp(`['"\`]${id.replace('.', '\\.')}[ :]`).test(sources);

/** The whole check as a pure function: TESTING.md text + concatenated test sources → verdict. */
export function checkIds(
  md: string,
  sources: string,
  sel: Selection,
): { ok: boolean; message: string } {
  let parsed: ReturnType<typeof parseTestingMd>;
  try {
    parsed = parseTestingMd(md);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const { phases, rows } = parsed;
  const expected = sel.all ? (sel.requiredPhases ?? REQUIRED_PHASES) : [sel.phase];
  const absent = expected.filter((p) => !phases.has(p));
  if (absent.length > 0) {
    return {
      ok: false,
      message: `docs/TESTING.md has no ${absent.map((p) => `## Phase ${p}`).join(', ')}`,
    };
  }
  const wanted = sel.all ? [...phases].sort((a, b) => Number(a) - Number(b)) : [sel.phase];
  const empty = wanted.filter((p) => !rows.some((r) => r.phase === p));
  if (empty.length > 0) {
    return {
      ok: false,
      message: `No test IDs found for ${empty.map((p) => `Phase ${p}`).join(', ')} in docs/TESTING.md`,
    };
  }
  const label = sel.all ? `phases ${wanted.join(', ')}` : `phase ${sel.phase}`;
  const picked = rows.filter((r) => wanted.includes(r.phase));
  const ids = (kind: Kind) => picked.filter((r) => r.kind === kind).map((r) => r.id);
  const required = ids('auto');
  const missing = required.filter((id) => !hasTest(id, sources));
  const stale = ids('dropped').filter((id) => hasTest(id, sources));
  const errors: string[] = [];
  if (missing.length > 0) errors.push(`Missing tests for ${label}:\n  ${missing.join('\n  ')}`);
  if (stale.length > 0) {
    errors.push(
      `dropped but still tested (remove the test or un-drop the row):\n  ${stale.join('\n  ')}`,
    );
  }
  if (errors.length > 0) return { ok: false, message: errors.join('\n') };
  const perPhase = wanted.map((p) => {
    const n = picked.filter((r) => r.phase === p && r.kind === 'auto').length;
    return `  phase ${p}: ${n} required`;
  });
  const list = (kind: Kind) => ids(kind).join(', ') || 'none';
  return {
    ok: true,
    message: [
      `check-ids: all ${required.length} ${label} test IDs present (${required.join(', ')})`,
      ...perPhase,
      `  dropped: ${list('dropped')}`,
      `  manual: ${list('manual')}`,
    ].join('\n'),
  };
}

const SKIP = new Set(['node_modules', '.output', '.output-e2e', '.wxt', '.git', 'dist']);
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(test\.tsx?|spec\.ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const args = process.argv.slice(2);
  const flag = args.indexOf('--phase');
  const phase = (flag >= 0 ? args[flag + 1] : process.env.SPECIMEN_PHASE) ?? '0';
  const all = args.includes('--all');
  if (!all && !/^\d+$/.test(phase)) {
    console.error(`Invalid phase: ${phase}`);
    process.exit(2);
  }
  const md = readFileSync(join(root, 'docs/TESTING.md'), 'utf8');
  const sources = walk(root)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const r = checkIds(md, sources, all ? { all: true } : { all: false, phase });
  (r.ok ? console.log : console.error)(r.message);
  if (!r.ok) process.exit(1);
}
