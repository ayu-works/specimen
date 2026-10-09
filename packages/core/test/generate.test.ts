import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  GENERATORS,
  generateCssVars,
  generateDesignMd,
  generateDtcg,
  generateFigma,
  generatePrompt,
  generateShadcn,
  generateTailwindV3,
  generateTailwindV4,
  PROMPT_TARGETS,
} from '../src/generate';
import { ROLE_ORDER } from '../src/generate/common';
import { brandTokens, isStopWord } from '../src/generate/sanitize';
import { ALL_NAMES, PAGES, REAL, roleHex, scanOf } from './helpers';

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const TARGETS = ['claude-code', 'cursor', 'v0', 'lovable'] as const;

/** Text with every `{ … }` block's declarations extracted: [{ selector, decls }]. Minimal CSS parse. */
function parseCss(css: string): { selector: string; decls: Map<string, string> }[] {
  const out: { selector: string; decls: Map<string, string> }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const decls = new Map<string, string>();
    for (const d of (m[2] ?? '').split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    out.push({ selector: (m[1] ?? '').trim(), decls });
  }
  return out;
}
const balanced = (s: string) => (s.match(/{/g)?.length ?? 0) === (s.match(/}/g)?.length ?? 0);

describe('generators: prompt', () => {
  it('T2.01 generic prompt contains every role hex, body + heading sizes, base unit, radii and the section list', () => {
    const scan = scanOf('landing-basic');
    const text = generatePrompt(scan).content.toLowerCase();
    for (const role of ROLE_ORDER) {
      const hex = roleHex(scan, role);
      if (hex) expect(text, `role ${role} ${hex}`).toContain(hex.toLowerCase());
    }
    for (const role of ['body', 'h1', 'h2', 'h3']) {
      const st = scan.typography.styles.find((s) => s.role === role);
      expect(st, role).toBeDefined();
      expect(text, `${role} size`).toMatch(new RegExp(`\\b${st?.size}\\b`));
    }
    expect(text).toContain(`${scan.spacing.baseUnit}px`);
    for (const k of ['button', 'card', 'input'] as const) {
      const v = scan.radii[k];
      if (v !== undefined) expect(text, `radius ${k}`).toContain(`${k}s ${v}px`);
    }
    // Section list: every blueprint kind appears in the layout section.
    const layout = text.slice(text.indexOf('## layout blueprint'));
    for (const kind of new Set(scan.layout.blueprint.map((s) => s.kind))) {
      expect(layout, `section ${kind}`).toContain(kind);
    }
  });

  it('T2.02 each target produces distinct wording and stack hints', () => {
    const scan = scanOf('landing-basic');
    const outs = Object.fromEntries(
      TARGETS.map((t) => [t, generatePrompt(scan, { target: t }).content]),
    );
    expect(new Set(Object.values(outs)).size).toBe(TARGETS.length);
    expect(outs['claude-code']).toMatch(/Claude Code/);
    expect(outs['claude-code']).toMatch(/Next\.js/);
    expect(outs.cursor).toMatch(/Cursor/);
    expect(outs.v0).toMatch(/shadcn/);
    expect(outs.lovable).toMatch(/Lovable/);
    // The generic target differs from all of them too.
    const generic = generatePrompt(scan).content;
    for (const t of TARGETS) expect(outs[t]).not.toBe(generic);
    // Snapshot the target-specific tail of each prompt.
    const tails = Object.fromEntries(
      [...PROMPT_TARGETS].map((t) => {
        const c = generatePrompt(scan, { target: t }).content;
        return [t, c.slice(c.indexOf('## Build instructions'))];
      }),
    );
    expect(tails).toMatchSnapshot();
  });

  it('T2.03 ethics guardrail: no host, brand, title or heading snippet in any prompt', () => {
    for (const name of ['injection', ...REAL] as const) {
      const scan = scanOf(name);
      const host = scan.host.toLowerCase().replace(/^www\./, '');
      const sld = host.split('.').slice(-2, -1)[0] ?? host;
      const snippets = scan.typography.styles
        .map((s) => s.sample?.trim() ?? '')
        // A lone common word ("Product") may legitimately survive as ordinary prose.
        .filter((s) => s.length >= 3 && (/\s/.test(s) || !isStopWord(s)));
      for (const target of [undefined, ...TARGETS]) {
        const text = generatePrompt(scan, { target }).content.toLowerCase();
        const where = `${name}/${target ?? 'generic'}`;
        expect(text, `${where} host`).not.toContain(host);
        if (sld.length >= 3) {
          expect(text, `${where} brand ${sld}`).not.toMatch(
            new RegExp(`(?<![\\p{L}\\p{N}])${sld}(?![\\p{L}\\p{N}])`, 'u'),
          );
        }
        if (scan.title.trim().length >= 3) {
          expect(text, `${where} title`).not.toContain(scan.title.trim().toLowerCase());
        }
        for (const s of snippets)
          expect(text, `${where} snippet "${s}"`).not.toContain(s.toLowerCase());
        for (const b of brandTokens(scan)) {
          expect(text, `${where} token ${b}`).not.toMatch(
            new RegExp(
              `(?<![\\p{L}\\p{N}])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
              'u',
            ),
          );
        }
      }
    }
    // The injection fixture's page text must never leak into the prompt.
    const inj = scanOf('injection');
    const text = generatePrompt(inj).content.toLowerCase();
    expect(text).not.toContain('ignore previous');
    expect(text).not.toContain('<page_data>');
    expect(text).not.toContain(inj.title.toLowerCase());
  });

  it('T2.04 prompt length is within 800–1500 approximate tokens on all fixtures', () => {
    // Approximate tokenizer: ~4 characters per token.
    for (const name of ALL_NAMES) {
      const text = generatePrompt(scanOf(name)).content;
      const tokens = Math.ceil(text.length / 4);
      expect(tokens, `${name}: ${tokens} tokens (${text.length} chars)`).toBeGreaterThanOrEqual(
        800,
      );
      expect(tokens, `${name}: ${tokens} tokens (${text.length} chars)`).toBeLessThanOrEqual(1500);
    }
  });
});

describe('generators: DESIGN.md', () => {
  it('T2.05 DESIGN.md has a table for colors, type, spacing, radii, shadows and layout, and is well-formed Markdown', () => {
    for (const name of ['landing-basic', 'pill', 'stripe'] as const) {
      const md = generateDesignMd(scanOf(name)).content;
      const lines = md.split('\n');
      const headings = lines.filter((l) => /^#{1,6} /.test(l));
      expect(headings.length, name).toBeGreaterThanOrEqual(6);
      // Tables: header row + separator row with the same number of cells.
      const tables: number[] = [];
      lines.forEach((l, i) => {
        if (/^\|\s*:?-{3,}/.test(l) && /^\|/.test(lines[i - 1] ?? '')) {
          const cols = (l.match(/\|/g)?.length ?? 0) - 1;
          expect((lines[i - 1]?.match(/\|/g)?.length ?? 0) - 1, `${name} table header`).toBe(cols);
          tables.push(i);
        }
      });
      expect(tables.length, `${name} tables`).toBeGreaterThanOrEqual(5);
      const lower = md.toLowerCase();
      for (const topic of ['color', 'typograph', 'spacing', 'radi', 'shadow', 'layout']) {
        expect(lower, `${name}: ${topic}`).toContain(topic);
      }
      // Fenced code blocks are balanced.
      expect(lines.filter((l) => l.startsWith('```')).length % 2, `${name} fences`).toBe(0);
    }
  });
});

describe('generators: code formats', () => {
  it('T2.06 Tailwind v4 output has an @theme block that defines --color-accent as the accent hex', () => {
    // NOTE: @tailwindcss/node is not a dependency of this package (and none may be added), so
    // this asserts structure with a minimal CSS parse instead of compiling `bg-accent`.
    for (const name of ALL_NAMES) {
      const scan = scanOf(name);
      const css = generateTailwindV4(scan).content;
      expect(css).toMatch(/^@import "tailwindcss";/);
      expect(balanced(css), name).toBe(true);
      const theme = parseCss(css).find((b) => b.selector.endsWith('@theme'));
      expect(theme, `${name} @theme`).toBeDefined();
      const accent = roleHex(scan, 'accent');
      if (accent) expect(theme?.decls.get('--color-accent'), name).toBe(accent);
      for (const [prop, value] of theme?.decls ?? []) {
        expect(prop, name).toMatch(/^--[a-z0-9-]+$/);
        expect(value.length, `${name} ${prop}`).toBeGreaterThan(0);
      }
      expect(theme?.decls.get('--font-body'), name).toBeTruthy();
    }
  });

  it('T2.07 Tailwind v3 config is valid CommonJS exporting theme.extend', () => {
    const require = createRequire(import.meta.url);
    for (const name of ['landing-basic', 'pill', 'linear'] as const) {
      const scan = scanOf(name);
      const src = generateTailwindV3(scan).content;
      const mod: { exports: unknown } = { exports: {} };
      new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
      const cfg = mod.exports as {
        theme: { extend: Record<string, Record<string, unknown>> };
      };
      expect(cfg.theme.extend, name).toBeDefined();
      for (const k of [
        'colors',
        'fontFamily',
        'fontSize',
        'borderRadius',
        'boxShadow',
        'spacing',
      ]) {
        expect(cfg.theme.extend[k], `${name}.${k}`).toBeDefined();
      }
      expect(cfg.theme.extend.colors?.accent, name).toBe(roleHex(scan, 'accent'));
    }
  });

  it('T2.08 CSS vars output parses and defines every role', () => {
    for (const name of ALL_NAMES) {
      const scan = scanOf(name);
      const css = generateCssVars(scan).content;
      expect(balanced(css), name).toBe(true);
      const blocks = parseCss(css);
      const root = blocks.find((b) => b.selector.endsWith(':root'));
      expect(root, `${name} :root`).toBeDefined();
      for (const role of ROLE_ORDER) {
        const hex = roleHex(scan, role);
        if (hex) expect(root?.decls.get(`--color-${kebab(role)}`), `${name} ${role}`).toBe(hex);
      }
      for (const block of blocks) {
        for (const [prop, value] of block.decls) {
          expect(prop, name).toMatch(/^--/);
          expect(value, `${name} ${prop}`).not.toBe('');
          expect(value, `${name} ${prop}`).not.toMatch(/undefined|NaN|\[object/);
        }
      }
    }
  });

  it('T2.09 shadcn theme defines all required variables in oklch', () => {
    const REQUIRED = [
      'background',
      'foreground',
      'card',
      'card-foreground',
      'popover',
      'popover-foreground',
      'primary',
      'primary-foreground',
      'secondary',
      'secondary-foreground',
      'muted',
      'muted-foreground',
      'accent',
      'accent-foreground',
      'destructive',
      'border',
      'input',
      'ring',
    ];
    for (const name of ALL_NAMES) {
      const css = generateShadcn(scanOf(name)).content;
      expect(balanced(css), name).toBe(true);
      const root = parseCss(css).find((b) => b.selector.endsWith(':root'));
      expect(root, name).toBeDefined();
      for (const v of REQUIRED) {
        const value = root?.decls.get(`--${v}`);
        expect(value, `${name} --${v}`).toMatch(
          /^oklch\(\s*[\d.]+%?\s+[\d.]+\s+[\d.]+(\s*\/\s*[\d.]+%?)?\s*\)$/,
        );
      }
      expect(root?.decls.get('--radius'), name).toMatch(/^[\d.]+(rem|px)$/);
    }
  });

  it('T2.10 DTCG JSON has $type and $value on every token; Figma JSON has collections → variables', () => {
    for (const name of ['landing-basic', 'pill', 'stripe'] as const) {
      const scan = scanOf(name);

      const dtcg = JSON.parse(generateDtcg(scan).content) as Record<string, unknown>;
      let leaves = 0;
      const walk = (node: unknown, path: string) => {
        const n = node as Record<string, unknown>;
        if ('$value' in n || '$type' in n) {
          expect(n.$type, `${name}:${path} $type`).toEqual(expect.any(String));
          expect(n.$value, `${name}:${path} $value`).toBeDefined();
          leaves++;
          return;
        }
        for (const [k, v] of Object.entries(n)) {
          expect(k.startsWith('$'), `${name}:${path}.${k}`).toBe(false);
          walk(v, `${path}.${k}`);
        }
      };
      walk(dtcg, '');
      expect(leaves, name).toBeGreaterThan(10);
      const color = dtcg.color as Record<string, { $type: string; $value: string }>;
      expect(color.accent?.$type).toBe('color');
      expect(color.accent?.$value).toBe(roleHex(scan, 'accent'));
      for (const c of Object.values(color))
        expect(c.$value).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);

      const figma = JSON.parse(generateFigma(scan).content) as {
        collections: {
          name: string;
          modes: string[];
          variables: { name: string; type: string; values: Record<string, unknown> }[];
        }[];
      };
      expect(figma.collections.length, name).toBeGreaterThan(0);
      for (const col of figma.collections) {
        expect(col.name).toEqual(expect.any(String));
        expect(col.modes.length).toBeGreaterThan(0);
        expect(col.variables.length).toBeGreaterThan(10);
        for (const v of col.variables) {
          expect(v.name, name).toEqual(expect.any(String));
          expect(['COLOR', 'FLOAT', 'STRING'], `${name}:${v.name}`).toContain(v.type);
          for (const mode of col.modes) {
            const val = v.values[mode];
            expect(val, `${name}:${v.name}`).toBeDefined();
            if (v.type === 'COLOR') {
              const c = val as Record<string, number>;
              for (const ch of ['r', 'g', 'b', 'a']) {
                expect(c[ch], `${name}:${v.name}.${ch}`).toBeGreaterThanOrEqual(0);
                expect(c[ch], `${name}:${v.name}.${ch}`).toBeLessThanOrEqual(1);
              }
            } else if (v.type === 'FLOAT') expect(val).toEqual(expect.any(Number));
            else expect(val).toEqual(expect.any(String));
          }
        }
      }
    }
  });

  it('T2.11 generators are pure: the same scan gives byte-identical output and the scan is not mutated', () => {
    for (const name of ['landing-serif', 'dense-app', 'ramp'] as const) {
      const scan = scanOf(name);
      const before = JSON.stringify(scan);
      for (const g of GENERATORS) {
        for (const target of g.id === 'prompt' ? [...TARGETS, undefined] : [undefined]) {
          const a = g.run(scan, { target });
          const b = g.run(structuredClone(scan), { target });
          expect(b, `${name}/${g.id}`).toEqual(a);
          expect(a.content.length, `${name}/${g.id}`).toBeGreaterThan(0);
          expect(a.content, `${name}/${g.id}`).not.toMatch(/undefined|NaN|\[object Object\]/);
        }
      }
      expect(JSON.stringify(scan), `${name} mutated`).toBe(before);
    }
    expect(PAGES.length).toBe(5);
  });
});
