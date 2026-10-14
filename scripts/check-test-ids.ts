// Usage: tsx scripts/check-test-ids.ts --phase 0   (or --phase=0, or SPECIMEN_PHASE=0)
//        tsx scripts/check-test-ids.ts --all       (every `## Phase <n>` in docs/TESTING.md; phases 0-7 must exist)
// Verifies every automated test ID of a phase in docs/TESTING.md names a test, `it('T<phase>.xx ...` /
// `test(...)` / `<x>Test(...)`, in a git-tracked or untracked-but-not-ignored *.test.ts(x) / *.spec.ts file.
// Manual (🖐) IDs are skipped; dropped (⊘) IDs are skipped and must NOT have a test. A required ID whose only
// test is .skip/.todo/.fixme fails. IDs tested only under OUTSIDE_GATE are listed apart: `pnpm gate` doesn't run them.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Kind = 'auto' | 'manual' | 'dropped';
export interface Row {
  id: string;
  phase: string;
  kind: Kind;
  /** The Test cell says the measurement is a non-blocking report (e.g. T7.02 Lighthouse). */
  reportOnly: boolean;
}

const MANUAL = '🖐';
const DROPPED = '⊘';
const DROPPED_PREFIX = /^\*\*Dropped \d{4}-\d{2}-\d{2}\*\* \([^)]+\)/;
/** Phases the product has; `--all` fails if one is missing from TESTING.md. */
export const REQUIRED_PHASES = ['0', '1', '2', '3', '4', '5', '6', '7'];
/** Test folders `pnpm gate` doesn't run (the video app runs in its own CI job). */
export const OUTSIDE_GATE = ['apps/video/'];
const ID_ROW = /^\|\s*(T\d+\.\d+)\s*\|(.*)\|\s*$/;
/** A table line whose first cell mentions an ID; it must then match ID_ROW exactly. */
const ID_ROW_CANDIDATE = /^\s*\|?[^|]*\bT\d+\.\d+/;

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
    const row = line.match(ID_ROW);
    if (!row) {
      if (line.includes('|') && ID_ROW_CANDIDATE.test(line)) {
        throw new Error(
          `docs/TESTING.md malformed ID row (want \`| T<n>.<nn> | … |\`): ${line.trim()}`,
        );
      }
      continue;
    }
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
    if (id.slice(1, id.indexOf('.')) !== phase) fail(`listed under ## Phase ${phase}`);
    seen.add(id);
    if (test === MANUAL || test === DROPPED)
      fail(`${test} must be in a Type cell, not the Test cell`);
    const manual = types.includes(MANUAL);
    const dropped = types.includes(DROPPED);
    if (manual && dropped) fail(`marked both ${MANUAL} and ${DROPPED}`);
    if (dropped && !DROPPED_PREFIX.test(test))
      fail(`${DROPPED} row must start with **Dropped YYYY-MM-DD** (reason)`);
    if (!dropped && /^\*\*Dropped\b/.test(test)) fail(`"Dropped" row needs Type ${DROPPED}`);
    const kind = dropped ? 'dropped' : manual ? 'manual' : 'auto';
    rows.push({ id, phase, kind, reportOnly: /\bnon-blocking\b/i.test(test) });
  }
  return { phases, rows };
}

export type Selection =
  | { all: true; requiredPhases?: readonly string[] }
  | { all: false; phase: string };

/** A test file: repo-relative path + contents. */
export interface Source {
  path: string;
  text: string;
}

const esc = (id: string) => id.replace('.', '\\.');
const named = (id: string) => `\\(\\s*['"\`]${esc(id)}[ :]`;
/** `it(` / `test(` / `pwTest(`, optionally `.only` / `.concurrent` (not `describe`: a group proves no test). */
const testCall = (id: string) =>
  new RegExp(`\\b(?:it|test|[a-z]+Test)(?:\\.(?:only|concurrent))?${named(id)}`);
const skippedCall = (id: string) =>
  new RegExp(
    `\\b(?:it|test|describe|[a-z]+Test)(?:\\.describe)?\\.(?:skip|todo|fixme)${named(id)}`,
  );

type Found = 'gated' | 'outside' | 'skipped' | 'absent';
function find(id: string, sources: readonly Source[], outsideGate: readonly string[]): Found {
  const call = testCall(id);
  const hits = sources.filter((s) => call.test(s.text));
  if (hits.some((s) => !outsideGate.some((dir) => s.path.startsWith(dir)))) return 'gated';
  if (hits.length > 0) return 'outside';
  const skip = skippedCall(id);
  return sources.some((s) => skip.test(s.text)) ? 'skipped' : 'absent';
}

/** The whole check as a pure function: TESTING.md text + test files → verdict. */
export function checkIds(
  md: string,
  sources: readonly Source[],
  sel: Selection,
  outsideGate: readonly string[] = OUTSIDE_GATE,
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
  const found = new Map(required.map((id) => [id, find(id, sources, outsideGate)]));
  const where = (f: Found) => required.filter((id) => found.get(id) === f);
  const missing = where('absent');
  const skipped = where('skipped');
  const stale = ids('dropped').filter((id) => find(id, sources, outsideGate) !== 'absent');
  const errors: string[] = [];
  if (missing.length > 0) errors.push(`Missing tests for ${label}:\n  ${missing.join('\n  ')}`);
  if (skipped.length > 0) {
    errors.push(`Only skipped (.skip/.todo/.fixme) tests for:\n  ${skipped.join('\n  ')}`);
  }
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
  const reportOnly = picked.filter((r) => r.kind === 'auto' && r.reportOnly).map((r) => r.id);
  const list = (xs: string[]) => xs.join(', ') || 'none';
  return {
    ok: true,
    message: [
      `check-ids: ${required.length} required test IDs present across ${label}`,
      ...perPhase,
      `  outside pnpm gate (${outsideGate.join(', ')}; run in their own CI job): ${list(where('outside'))}`,
      `  report-only (tests present; the measurement itself is a non-blocking CI report): ${list(reportOnly)}`,
      `  dropped: ${list(ids('dropped'))}`,
      `  manual: ${list(ids('manual'))}`,
    ].join('\n'),
  };
}

const USAGE = 'usage: check-test-ids (--all | --phase <n> | --phase=<n>), or SPECIMEN_PHASE=<n>';

/** CLI args → selection; an unknown, missing or conflicting argument is an error, never a default. */
export function parseArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): Selection | { error: string } {
  let all = false;
  let phase: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--all') all = true;
    else if (a === '--phase') {
      phase = argv[++i];
      if (phase === undefined) return { error: `--phase needs a value; ${USAGE}` };
    } else if (a.startsWith('--phase=')) phase = a.slice('--phase='.length);
    else return { error: `unknown argument ${a}; ${USAGE}` };
  }
  if (all && phase !== undefined) return { error: `--all and --phase together; ${USAGE}` };
  if (all) return { all: true };
  phase ??= env.SPECIMEN_PHASE;
  if (phase === undefined) return { error: USAGE };
  if (!/^\d+$/.test(phase)) return { error: `Invalid phase: ${phase}` };
  return { all: false, phase };
}

/** Test files git would commit: tracked, or untracked and not ignored (skips .claude/, outputs, node_modules). */
function testFiles(root: string): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '-co', '--exclude-standard', '--', '*.test.ts', '*.test.tsx', '*.spec.ts'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return out.split('\0').filter((f) => f && existsSync(join(root, f)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sel = parseArgs(process.argv.slice(2), process.env);
  if ('error' in sel) {
    console.error(sel.error);
    process.exit(2);
  }
  const md = readFileSync(join(root, 'docs/TESTING.md'), 'utf8');
  const sources = testFiles(root).map((path) => ({
    path,
    text: readFileSync(join(root, path), 'utf8'),
  }));
  const r = checkIds(md, sources, sel);
  (r.ok ? console.log : console.error)(r.message);
  if (!r.ok) process.exit(1);
}
