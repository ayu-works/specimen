// Run: pnpm test:scripts (node:test via tsx).
// Fixture IDs use phases 98/99, which never exist in docs/TESTING.md: check-ids scans this file too, so a real ID
// in a fixture string would count as a real test (and a dropped one as "still tested").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { checkIds, parseArgs, parseTestingMd, type Source } from './check-test-ids';

const DROP = '**Dropped 2026-10-09** (cut): ~~old~~';
const doc = (...phases: string[]) => phases.join('\n\n');
const phase = (n: number, ...rows: string[]) =>
  [`## Phase ${n}: Fixture`, '| ID | Type | Test |', '|---|---|---|', ...rows].join('\n');
const file = (text: string, path = 'packages/x/a.test.ts'): Source[] => [{ path, text }];
const named = (...ids: string[]) =>
  file(ids.map((id) => `it('${id} does a thing', () => {});`).join('\n'));
const ALL = { all: true, requiredPhases: ['98', '99'] } as const;
const ALL_98 = { all: true, requiredPhases: ['98'] } as const;

const MD = doc(
  phase(98, '| T98.01 | U | a |', '| T98.02 | 🖐 | b |'),
  phase(99, '| T99.01 | E | c |', `| T99.02 | ⊘ | ${DROP} |`),
);

describe('check-ids', () => {
  test('a dropped ID is skipped: not required, reported as dropped, not as present', () => {
    const r = checkIds(MD, named('T98.01', 'T99.01'), { all: true, requiredPhases: ['98', '99'] });
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /dropped: T99\.02/);
    assert.match(r.message, /^check-ids: 2 required test IDs present/);
  });

  test('a missing non-dropped ID fails', () => {
    const r = checkIds(MD, named('T98.01'), { all: true, requiredPhases: ['98', '99'] });
    assert.equal(r.ok, false);
    assert.match(r.message, /Missing tests[\s\S]*T99\.01/);
  });

  test('a dropped ID that still has a test fails as drift', () => {
    const r = checkIds(MD, named('T98.01', 'T99.01', 'T99.02'), {
      all: true,
      requiredPhases: ['98', '99'],
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /dropped but still tested[\s\S]*T99\.02/);
  });

  test('manual IDs are still skipped', () => {
    const r = checkIds(MD, named('T98.01', 'T99.01'), { all: true, requiredPhases: ['98', '99'] });
    assert.match(r.message, /manual: T98\.02/);
  });

  test('--all covers every phase heading, including ones past the required list', () => {
    const r = checkIds(MD, named('T98.01'), { all: true, requiredPhases: ['98'] });
    assert.equal(r.ok, false, 'phase 99 must be gated even though only 98 is required');
    assert.match(r.message, /T99\.01/);
  });

  test('--all fails when a required phase heading is missing', () => {
    const r = checkIds(MD, named('T98.01', 'T99.01'), {
      all: true,
      requiredPhases: ['98', '99', '97'],
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /Phase 97/);
  });

  test('a phase with only dropped or manual rows passes with "0 required" stated', () => {
    const md = doc(phase(98, '| T98.01 | U | a |'), phase(99, `| T99.02 | ⊘ | ${DROP} |`));
    const r = checkIds(md, named('T98.01'), { all: true, requiredPhases: ['98', '99'] });
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /phase 99: 0 required/);
    assert.match(r.message, /phase 98: 1 required/);
  });

  test('--phase checks one phase only', () => {
    const r = checkIds(MD, named('T98.01'), { all: false, phase: '98' });
    assert.equal(r.ok, true, r.message);
    assert.equal(checkIds(MD, [], { all: false, phase: '97' }).ok, false);
  });

  test('a phase heading with no rows fails', () => {
    const md = doc(phase(98, '| T98.01 | U | a |'), phase(99));
    const r = checkIds(md, named('T98.01'), { all: true, requiredPhases: ['98'] });
    assert.equal(r.ok, false);
    assert.match(r.message, /Phase 99/);
  });

  test('malformed rows throw', () => {
    const bad = {
      'duplicate ID': phase(98, '| T98.01 | U | a |', '| T98.01 | U | b |'),
      '🖐 and ⊘ on one row': phase(98, `| T98.01 | 🖐 | ⊘ | ${DROP} |`),
      '⊘ without a Dropped prefix': phase(98, '| T98.01 | ⊘ | old text |'),
      '⊘ without a reason': phase(98, '| T98.01 | ⊘ | **Dropped 2026-10-09** ~~old~~ |'),
      'ID under another phase': phase(98, '| T98.01 | U | a |', '| T99.01 | U | b |'),
      '⊘ with a bad date': phase(98, '| T98.01 | ⊘ | **Dropped 2026-10** (cut) |'),
      'Dropped prefix without ⊘': phase(98, `| T98.01 | U | ${DROP} |`),
      '⊘ outside a Type cell': phase(98, '| T98.01 | ⊘ |').replace(
        '| ID | Type | Test |',
        '| ID | Test |',
      ),
    };
    for (const [name, md] of Object.entries(bad)) {
      assert.throws(() => parseTestingMd(md), Error, name);
    }
  });

  test('a malformed ID row throws instead of being skipped', () => {
    const shapes = [
      '| **T98.02** | U | b |',
      '| `T98.02` | U | b |',
      '  | T98.02 | U | b |',
      '| T98.02 | U | b',
      '| T98.02a | U | b |',
      'T98.02 | U | b |',
    ];
    for (const row of shapes) {
      assert.throws(
        () => parseTestingMd(phase(98, '| T98.01 | U | a |', row)),
        /malformed ID row/,
        row,
      );
    }
  });

  test('only a test call counts: comments, error strings and describe groups do not', () => {
    const md = phase(98, '| T98.01 | U | a |');
    for (const text of [
      "// see 'T98.01 later'",
      "throw new Error('T98.01: x');",
      "describe('T98.01 group', () => {});",
      "test.describe('T98.01 group', () => {});",
    ]) {
      const r = checkIds(md, file(text), ALL_98);
      assert.equal(r.ok, false, text);
      assert.match(r.message, /Missing tests[\s\S]*T98\.01/, text);
    }
    for (const text of [
      "test('T98.01: x', () => {})",
      "pwTest('T98.01 x', () => {})",
      "it.only('T98.01 x')",
    ]) {
      assert.equal(checkIds(md, file(text), ALL_98).ok, true, text);
    }
  });

  test('an ID whose only tests are skipped fails', () => {
    const md = phase(98, '| T98.01 | U | a |');
    for (const text of [
      "it.skip('T98.01 x', () => {})",
      "it.todo('T98.01 x')",
      "test.fixme('T98.01 x', () => {})",
      "describe.skip('T98.01 group', () => {})",
    ]) {
      const r = checkIds(md, file(text), ALL_98);
      assert.equal(r.ok, false, text);
      assert.match(r.message, /Only skipped[\s\S]*T98\.01/, text);
    }
  });

  test('a dropped ID in a skipped test is still drift', () => {
    const r = checkIds(
      MD,
      [...named('T98.01', 'T99.01'), ...file("it.skip('T99.02 x')", 'b.test.ts')],
      ALL,
    );
    assert.equal(r.ok, false);
    assert.match(r.message, /dropped but still tested[\s\S]*T99\.02/);
  });

  test('an ID tested only outside the gate passes but is listed apart', () => {
    const md = phase(98, '| T98.01 | U | a |', '| T98.02 | U | b |');
    const video = file("it('T98.02 x', () => {})", 'apps/video/test/x.test.ts');
    const r = checkIds(md, [...named('T98.01'), ...video], ALL_98);
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /outside pnpm gate[^\n]*: T98\.02$/m);
    const both = checkIds(md, [...named('T98.01', 'T98.02'), ...video], ALL_98);
    assert.match(both.message, /outside pnpm gate[^\n]*: none$/m);
  });

  test('a row whose Test cell says non-blocking is listed as report-only', () => {
    const md = phase(
      98,
      '| T98.01 | E | score ≥ 95: **a CI report, non-blocking** |',
      '| T98.02 | U | b |',
    );
    const r = checkIds(md, named('T98.01', 'T98.02'), ALL_98);
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /report-only[^\n]*: T98\.01$/m);
  });

  test('CLI args: unknown, missing or conflicting arguments are errors, never phase 0', () => {
    assert.deepEqual(parseArgs(['--all']), { all: true });
    assert.deepEqual(parseArgs(['--phase', '7']), { all: false, phase: '7' });
    assert.deepEqual(parseArgs(['--phase=7']), { all: false, phase: '7' });
    assert.deepEqual(parseArgs([], { SPECIMEN_PHASE: '3' }), { all: false, phase: '3' });
    for (const argv of [[], ['--phase'], ['--al'], ['--all', '--phase', '7'], ['--phase', 'x']]) {
      assert.ok('error' in parseArgs(argv), JSON.stringify(argv));
    }
  });

  test('the real TESTING.md parses, has phases 0-7, and no fixture phase 98/99', () => {
    const md = readFileSync(new URL('../docs/TESTING.md', import.meta.url), 'utf8');
    const { phases } = parseTestingMd(md);
    for (const p of ['0', '1', '2', '3', '4', '5', '6', '7'])
      assert.ok(phases.has(p), `phase ${p}`);
    assert.ok(!phases.has('98') && !phases.has('99'));
  });
});
