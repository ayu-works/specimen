import type { DesignScan } from '../schema';

/** Common English / web words that are never treated as brand tokens. */
const STOP = new Set(
  (
    'the and for with your you our all new best how why what who when where more from that this ' +
    'into about home page pages site website web app apps online free fast simple smart better ' +
    'way ways world life work works working team teams modern platform software product products ' +
    'system systems design designs designer tool tools build built builds building make made get ' +
    'grow scale open source code developer developers business company data cloud service services ' +
    'solution solutions official welcome login sign signup pricing blog docs documentation help ' +
    'support contact customer customers enterprise infrastructure financial revenue payments ' +
    'payment manage management create creating start started use using used one any every each ' +
    'next level future today tomorrow digital internet network global just not but are can will ' +
    'have has was were been their them they its than then also very most much many other such ' +
    'only own same too out off over under again here there now new first last good great real ' +
    'full high low big small light dark black white red green blue yellow orange purple pink gray ' +
    'grey text color colour font type layout style theme component components button buttons card ' +
    'cards input form forms link links nav navigation header footer section sections hero feature ' +
    'features pricing plan plans team company about people tools api apis com org net www'
  ).split(' '),
);

export function isStopWord(w: string): boolean {
  return STOP.has(w.toLowerCase());
}

/** Second-level domain (handles `co.uk`-style suffixes). */
function secondLevel(host: string): string {
  const parts = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const second = parts[parts.length - 2] ?? '';
  if (parts.length >= 3 && ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(second)) {
    return parts[parts.length - 3] ?? second;
  }
  return second;
}

/** Lower-cased brand tokens derived from the host and the page title. */
export function brandTokens(scan: Pick<DesignScan, 'host' | 'title'>): string[] {
  const set = new Set<string>();
  const sld = secondLevel(scan.host);
  if (sld.length >= 2) set.add(sld);
  for (const piece of sld.split(/[^\p{L}\p{N}]+/u)) {
    if (piece.length >= 3 && !isStopWord(piece)) set.add(piece);
  }
  for (const w of scan.title.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 3 && !isStopWord(w)) set.add(w);
  }
  return [...set].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function containsBrand(text: string, tokens: string[]): boolean {
  const t = text.toLowerCase();
  return tokens.some((b) => wordRegex(b).test(t));
}

const WORD_L = '(?<![\\p{L}\\p{N}])';
const WORD_R = '(?![\\p{L}\\p{N}])(?!-gradient)';

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordRegex(w: string): RegExp {
  return new RegExp(`${WORD_L}${esc(w)}${WORD_R}`, 'giu');
}

function devMode(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const mode = env?.NODE_ENV;
  return mode === 'development' || mode === 'test';
}

/**
 * Ethics guardrail, final pass. Removes the host, title, headline samples and brand tokens
 * (case-insensitive, whole words) and throws in dev/test if the host still appears.
 */
export function sanitize(text: string, scan: DesignScan): string {
  const host = scan.host.toLowerCase().replace(/^www\./, '');
  const phrases: string[] = [scan.host, host, scan.title];
  try {
    phrases.push(new URL(scan.url).origin);
  } catch {
    /* url not parseable: skip */
  }
  for (const s of scan.typography.styles) {
    const sample = s.sample?.trim();
    if (!sample || sample.length < 3) continue;
    // A lone common word ("Product") would corrupt ordinary prose, so only multi-word
    // samples and uncommon single words are removed.
    if (/\s/.test(sample) || !isStopWord(sample)) phrases.push(sample);
  }
  const patterns = [
    ...phrases
      .filter((p) => p.trim().length >= 3)
      .sort((a, b) => b.length - a.length)
      .map((p) => new RegExp(esc(p.trim()), 'giu')),
    ...brandTokens(scan).map(wordRegex),
  ];

  const out = text.split('\n').map((line) => {
    let cur = line;
    let hit = false;
    for (const re of patterns) {
      const next = cur.replace(re, '');
      if (next !== cur) hit = true;
      cur = next;
    }
    return hit ? cur.replace(/(\S) {2,}(?=\S)/g, '$1 ').replace(/\( +/g, '(') : cur;
  });
  const result = out.join('\n');

  if (host.length >= 3 && result.toLowerCase().includes(host)) {
    if (devMode()) throw new Error('sanitize: host still present in generated output');
    return result.split(new RegExp(esc(host), 'gi')).join('');
  }
  return result;
}
