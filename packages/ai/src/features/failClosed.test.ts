import { sanitize } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockProvider } from '../testing/mockProvider';
import { loadFixtureScan } from '../testing/testUtils';
import { ProviderError } from '../types';
import { ask } from './ask';
import { runCritique } from './critique';
import { polishPrompt } from './polishPrompt';
import { VIBE_FILTERED, vibe } from './vibe';

// A sanitizer that throws (as a regex V8 rejects would, SPC-17 sec M1) while `broken.on` is set,
// after `allow` successful `sanitize` calls.
const broken = vi.hoisted(() => ({ on: false, allow: 0, calls: 0 }));
vi.mock('@specimen/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@specimen/core')>();
  const boom = () => {
    throw new SyntaxError('Invalid regular expression: /…/: Regular expression too large');
  };
  return {
    ...core,
    sanitize: (text: string, scan: DesignScan) =>
      broken.on && broken.calls++ >= broken.allow ? boom() : core.sanitize(text, scan),
    createStreamSanitizer: (scan: DesignScan) => {
      const next = core.createStreamSanitizer(scan);
      return (raw: string) => (broken.on ? boom() : next(raw));
    },
  };
});

afterEach(() => {
  Object.assign(broken, { on: false, allow: 0, calls: 0 });
});

const scan: DesignScan = {
  ...loadFixtureScan('landing-basic'),
  host: 'zentrix.io',
  url: 'https://zentrix.io/',
  title: 'Zentrix',
};
const RAW = 'Zentrix uses #1a2b3c at 16px.';

describe('a sanitizer error fails closed: never the raw text (SPC-17 sec M1)', () => {
  it('T3.22 council turns come back empty and filtered, never raw, when the sanitizer throws', async () => {
    broken.on = true;
    const p = createMockProvider({ text: RAW, chunkSize: 4 });
    const snaps: string[] = [];
    const r = await runCritique(p, scan, { onTurn: (_i, t) => snaps.push(t.content) });
    for (const s of snaps) expect(s).toBe('');
    for (const t of r.turns) {
      expect(t.content).toBe('');
      expect(t.status).toBe('filtered');
    }
    for (const call of p.calls) expect(JSON.stringify(call.messages)).not.toContain(RAW);
  });

  it('T3.08 ask snapshots and the answer are empty, never raw, when the sanitizer throws', async () => {
    broken.on = true;
    const p = createMockProvider({ text: RAW, chunkSize: 4 });
    const seen: string[] = [];
    const out = await ask(p, scan, 'q', [], { onText: (t) => seen.push(t) });
    expect(out).toBe('');
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(s).toBe('');
  });

  it('polishPrompt keeps the original prompt when the sanitizer throws', async () => {
    const prompt = 'Use #1a2b3c at 16px.';
    const p = createMockProvider({ text: RAW });
    broken.on = true;
    const r = await polishPrompt(p, scan, prompt);
    expect(r).toMatchObject({ text: prompt, polished: false });
  });

  it('Vibe rejects as filtered, with no summary or keywords, when sanitizing the summary throws', async () => {
    // The first call (the whole reply, in collect) passes; the summary's own pass throws. The old
    // code then returned the raw summary.
    Object.assign(broken, { on: true, allow: 1 });
    const p = createMockProvider({ text: '{"summary":"Calm and airy.","keywords":["calm"]}' });
    await expect(vibe(p, scan, null)).rejects.toMatchObject({
      kind: 'other',
      message: VIBE_FILTERED,
    });
    expect(broken.calls).toBe(2);
  });

  it('Vibe rejects, never raw, when the whole reply cannot be sanitized', async () => {
    broken.on = true;
    const p = createMockProvider({ text: '{"summary":"Zentrix calm","keywords":["calm"]}' });
    await expect(vibe(p, scan, null)).rejects.toMatchObject({ kind: 'other' });
  });
});

describe('council exits keep the full sanitized text (SPC-32 lens B L6)', () => {
  it('T3.22 a turn that fails mid-way on one long line keeps every sanitized character, not a lagging snapshot', async () => {
    const line = 'Zentrix uses #1a2b3c at 16px and calm spacing. '.repeat(40);
    const chunks = line.match(/.{1,7}/g) ?? [];
    const p = createMockProvider({
      chunks,
      error: new ProviderError('other', 'boom'),
      errorAfter: chunks.length,
    });
    const r = await runCritique(p, scan, { retryDelaysMs: [] });
    const turn = r.turns[0];
    expect(turn?.status).toBe('error');
    expect(turn?.content).toBe(sanitize(line, scan));
    expect(turn?.content.toLowerCase()).not.toContain('zentrix');
  });
});

describe('Vibe keywords', () => {
  it('a summary that survives the filter keeps its sanitized keywords only', async () => {
    const p = createMockProvider({
      text: '{"summary":"Calm Zentrix look.","keywords":["zentrix","calm"]}',
    });
    const v = await vibe(p, scan, null);
    expect(v.summary.toLowerCase()).not.toContain('zentrix');
    expect(v.keywords).toEqual(['calm']);
  });
});
