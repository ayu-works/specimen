import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTable } from 'micromark-extension-gfm-table';
import { describe, expect, it } from 'vitest';
import { generateDesignMd } from '../src/generate';
import { code, table } from '../src/generate/common';
import { scanOf } from './helpers';

type Table = Extract<ReturnType<typeof fromMarkdown>['children'][number], { type: 'table' }>;

/** Parse with the GFM table tokenizer remark-gfm uses; every table, as rows of cell texts. */
function parseTables(md: string): string[][][] {
  const tree = fromMarkdown(md, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
  const text = (n: unknown): string => {
    const node = n as { value?: string; children?: unknown[] };
    return node.value ?? (node.children ?? []).map(text).join('');
  };
  return tree.children
    .filter((n): n is Table => n.type === 'table')
    .map((t) => t.children.map((row) => row.children.map(text)));
}

// A backslash run before a pipe, in every position (SPC-32 lens B L5), plus controls.
const PIPES = ['a\\|b', 'a\\\\|b', 'a\\\\\\|b', '\\|a', 'a|\\|b\\', 'a|b', 'plain'];
// Backslashes with no pipe after them: cell() leaves them alone.
const LONE = ['a\\', 'a\\\\', '\\2014'];
// Inside a code span a run before a pipe shows doubled (no escapes there; see cell()).
const doubled = (p: string) => p.replace(/(\\*)\|/g, '$1$1|');

describe('DESIGN.md table cells (SPC-36)', () => {
  it('T2.05 a backslash before | never splits a plain-text table cell, and reads back exactly', () => {
    const [rows] = parseTables(
      table(
        ['A', 'B'],
        PIPES.map((p) => [p, 'next']),
      ),
    );
    expect(rows?.slice(1)).toEqual(PIPES.map((p) => [p, 'next']));
  });

  it('T2.05 a backslash before | never splits a code cell; the run reads back doubled', () => {
    const all = [...PIPES, ...LONE];
    const [rows] = parseTables(
      table(
        ['A', 'B'],
        all.map((p) => [code(p), 'next']),
      ),
    );
    expect(rows?.slice(1)).toEqual(all.map((p) => [doubled(p), 'next']));
    expect(doubled('a\\|b')).toBe('a\\\\|b');
  });

  it('T2.05 a CSS variable with a backslash before | keeps its row in DESIGN.md', () => {
    const all = [...PIPES, ...LONE];
    const scan = scanOf('landing-basic');
    scan.cssVariables = Object.fromEntries(all.map((p, i) => [`--p${i}`, p]));
    const vars = parseTables(generateDesignMd(scan).content).find((t) => t[1]?.[0] === '--p0');
    expect(vars?.slice(1)).toEqual(all.map((p, i) => [`--p${i}`, doubled(p)]));
  });

  it('T2.05 every DESIGN.md table row has the header column count', () => {
    for (const name of ['landing-basic', 'pill', 'stripe'] as const) {
      for (const t of parseTables(generateDesignMd(scanOf(name)).content)) {
        for (const row of t) expect(row).toHaveLength(t[0]?.length ?? 0);
      }
    }
  });
});
