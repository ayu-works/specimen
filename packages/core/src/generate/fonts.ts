import type { DesignScan } from '../schema';
import { type Family, familyByRole } from './common';
import { brandTokens, containsBrand } from './sanitize';

export type FontKind = 'serif' | 'sans' | 'mono';

const GENERIC = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];

function stackParts(stack: string): string[] {
  return stack
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function classifyFamily(f: Family): FontKind {
  if (f.role === 'mono') return 'mono';
  const lower = stackParts(f.stack).map((p) => p.replace(/["']/g, '').toLowerCase());
  const generic = [...lower].reverse().find((p) => GENERIC.includes(p));
  if (generic === 'monospace') return 'mono';
  if (generic === 'serif') return 'serif';
  if (generic === 'sans-serif' || generic === 'system-ui') return 'sans';
  const name = f.name.toLowerCase();
  if (/mono|code|courier/.test(name)) return 'mono';
  if (
    /serif|georgia|times|garamond|playfair|merriweather|lora|newsreader/.test(name) &&
    !/sans/.test(name)
  )
    return 'serif';
  return 'sans';
}

export interface FontInfo {
  role: Family['role'];
  kind: FontKind;
  /** Name safe to print (a placeholder when the family name carries the brand). */
  label: string;
  /** Brand-free CSS font stack (max 6 entries, always ends with a generic family). */
  stack: string;
  /** Free alternative to recommend, when the source font is proprietary or unknown. */
  alternative?: string;
  branded: boolean;
}

const GENERIC_FOR: Record<FontKind, string> = {
  sans: 'system-ui, sans-serif',
  serif: 'Georgia, serif',
  mono: 'ui-monospace, monospace',
};

function alternativeFor(name: string, kind: FontKind): string {
  if (kind === 'mono') return 'JetBrains Mono';
  if (kind === 'serif') return 'Source Serif 4';
  if (/cal\s*sans|display/i.test(name)) return 'Inter Display';
  return 'Inter';
}

export function fontInfo(scan: DesignScan, family: Family): FontInfo {
  const tokens = brandTokens(scan);
  const kind = classifyFamily(family);
  const branded = containsBrand(family.name, tokens);
  const parts = stackParts(family.stack).filter((p) => !containsBrand(p, tokens));
  const isGeneric = (p: string) => GENERIC.includes(p.replace(/["']/g, '').toLowerCase());
  const head = parts.slice(0, 5);
  const tail = [...parts].reverse().find(isGeneric);
  let stack = [...head, ...(head.some(isGeneric) ? [] : [tail ?? GENERIC_FOR[kind]])].join(', ');
  const proprietary = family.source === 'unknown' || family.source === 'self-hosted' || branded;
  if (branded) stack = `"${alternativeFor(family.name, kind)}", ${GENERIC_FOR[kind]}`;
  const faceWord = family.role === 'mono' ? 'monospace' : family.role;
  return {
    role: family.role,
    kind,
    label: branded ? `the source's custom ${faceWord} face` : family.name,
    stack,
    alternative: proprietary ? alternativeFor(family.name, kind) : undefined,
    branded,
  };
}

/** Display, body and mono font info (each possibly undefined for mono). */
export function fontSet(scan: DesignScan): {
  display: FontInfo;
  body: FontInfo;
  mono?: FontInfo;
} {
  const body = familyByRole(scan, 'body');
  const display = familyByRole(scan, 'display') ?? body;
  const mono = familyByRole(scan, 'mono');
  const fallback: Family = {
    id: 'system',
    name: 'system-ui',
    stack: 'system-ui, sans-serif',
    role: 'body',
    source: 'system',
    weights: [400],
  };
  const bodyInfo = fontInfo(scan, body ?? fallback);
  return {
    display: display ? fontInfo(scan, display) : bodyInfo,
    body: bodyInfo,
    mono: mono ? fontInfo(scan, mono) : undefined,
  };
}

/** `Inter or similar` style phrase for a family. */
export function fontPhrase(f: FontInfo): string {
  if (f.alternative) return `${f.label}. Free alternative: ${f.alternative} or similar`;
  return f.label;
}
