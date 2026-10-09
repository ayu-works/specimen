// Usage: tsx scripts/check-test-ids.ts --phase 0
//        tsx scripts/check-test-ids.ts --all     (phases 0-5; phases 6-7 aren't built yet)
// Verifies every non-manual (Type != 🖐) test ID of a phase in docs/TESTING.md appears
// as `'T<phase>.xx ...` in a *.test.ts(x) / *.spec.ts file.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const all = args.includes('--all');
const flag = args.indexOf('--phase');
const phase = (flag >= 0 ? args[flag + 1] : process.env.SPECIMEN_PHASE) ?? '0';
if (!all && !/^\d+$/.test(phase)) {
  console.error(`Invalid phase: ${phase}`);
  process.exit(2);
}
/** Phases that exist in the product so far; --all skips the rest (6-7 aren't built). */
const BUILT_PHASES = new Set(['0', '1', '2', '3', '4', '5']);
const wanted = (p: string) => (all ? BUILT_PHASES.has(p) : p === phase);
const label = all ? 'phases 0-5' : `phase ${phase}`;

const md = readFileSync(join(root, 'docs/TESTING.md'), 'utf8');
const ids = new Map<string, boolean>(); // id -> manual?
let inPhase = false;
for (const line of md.split('\n')) {
  const h = line.match(/^##\s+Phase\s+(\d+)\b/);
  if (h) inPhase = wanted(h[1] as string);
  if (!inPhase) continue;
  const row = line.match(/^\|\s*(T\d+\.\d+)\s*\|(.*)\|\s*$/);
  if (!row) continue;
  const cells = line.split('|').map((c) => c.trim());
  // cells: ['', id, (type,)? test, '']; a Type column exists only in some tables
  const manual = cells.slice(2, -1).some((c) => c === '🖐');
  ids.set(row[1] as string, manual);
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
const sources = walk(root)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const required = [...ids].filter(([, manual]) => !manual).map(([id]) => id);
if (required.length === 0) {
  console.error(`No test IDs found for ${label} in docs/TESTING.md`);
  process.exit(1);
}
const missing = required.filter(
  (id) => !new RegExp(`['"\`]${id.replace('.', '\\.')}[ :]`).test(sources),
);
if (missing.length > 0) {
  console.error(`Missing tests for ${label}:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-ids: all ${required.length} ${label} test IDs present (${required.join(', ')})`);
