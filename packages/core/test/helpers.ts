import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from '../src/extract';
import { type ColorRole, type DesignScan, RawPageSchema } from '../src/schema';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
export const PAGES = ['landing-basic', 'landing-serif', 'dense-app', 'pill', 'injection'] as const;
export const REAL = ['linear', 'stripe', 'ramp', 'cal'] as const;
export const ALL_NAMES = [...PAGES, ...REAL] as const;
export type FixtureName = (typeof ALL_NAMES)[number];

export const loadRaw = (rel: string) =>
  RawPageSchema.parse(JSON.parse(readFileSync(join(FIXTURES, 'raw', `${rel}.json`), 'utf8')));

const cache = new Map<string, DesignScan>();
/** Extracted scan of a fixture page (`landing-basic`) or a real site (`linear`). Cached. */
export function scanOf(name: FixtureName): DesignScan {
  let s = cache.get(name);
  if (!s) {
    const rel = (PAGES as readonly string[]).includes(name) ? `pages/${name}` : name;
    s = extract(loadRaw(rel), { id: `test-${name}` });
    cache.set(name, s);
  }
  return structuredClone(s);
}

export function roleHex(scan: DesignScan, role: ColorRole): string | undefined {
  const id = scan.colors.roles[role];
  return id ? scan.colors.palette.find((t) => t.id === id)?.hex : undefined;
}
