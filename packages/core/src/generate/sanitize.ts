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

// Caps on hostile input (SPC-17 sec H1, M1). A page title or an imported scan can be any length, and
// every token and phrase becomes a regex: uncapped, a 30k-char title took seconds per call and a
// 32k+ one made V8 reject the pattern.
/** Only the start of the title is read for brand tokens. */
export const TITLE_SCAN = 300;
/** At most this many title tokens (the domain's own tokens are always kept). */
export const MAX_TITLE_TOKENS = 12;
/** Longer tokens are dropped: a DNS label is at most 63 characters, so no real domain is lost. */
export const MAX_TOKEN = 64;
/** Longer phrases (title, headline samples) are skipped; their words are still tokens. */
export const MAX_PHRASE = 1000;
/** At most this many headline samples are removed as phrases. */
export const MAX_SAMPLES = 50;

const isToken = (w: string) => w.length >= 3 && w.length <= MAX_TOKEN && !isStopWord(w);

/** Lower-cased brand tokens derived from the host and the page title. */
export function brandTokens(scan: Pick<DesignScan, 'host' | 'title'>): string[] {
  const set = new Set<string>();
  const sld = secondLevel(scan.host);
  if (sld.length >= 2 && sld.length <= MAX_TOKEN) set.add(sld);
  for (const piece of sld.split(/[^\p{L}\p{N}]+/u)) {
    if (isToken(piece)) set.add(piece);
  }
  const words = scan.title
    .slice(0, TITLE_SCAN)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u);
  // A word cut by the window is a fragment, not a word.
  if (scan.title.length > TITLE_SCAN) words.pop();
  let n = 0;
  for (const w of words) {
    if (n >= MAX_TITLE_TOKENS) break;
    if (isToken(w) && !set.has(w)) {
      set.add(w);
      n++;
    }
  }
  return [...set].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** Case is kept: a camelCase hump (`zentrixBlue`) is a boundary, so lower-casing would hide it. */
export function containsBrand(text: string, tokens: string[]): boolean {
  return tokens.some((b) => wordRegex(b).once.test(text));
}

/**
 * True when a CSS variable name carries a brand token: at a word, case or digit boundary, or (for
 * tokens of 4+ characters) anywhere, since `--zentrixblue` has no boundary at all. Short tokens
 * (`hp`) need a boundary, or `--php-version` would match.
 */
export function nameHasBrand(name: string, tokens: string[]): boolean {
  const lower = name.toLowerCase();
  return tokens.some((b) => (b.length >= 4 && lower.includes(b)) || wordRegex(b).once.test(name));
}

// Boundaries are case-sensitive (a hump is lower→upper), so the regex can't use the `i` flag:
// under /iu, \p{Lu} also matches lowercase letters. The token itself is spelled per character.
const BOUND_L = [
  '(?<![\\p{L}\\p{N}])', // start of a word
  '(?<=\\p{Ll})(?=\\p{Lu})', // camel hump: myZentrix
  '(?<=\\p{Lu})(?=\\p{Lu}\\p{Ll})', // after an acronym: UIZentrix
];
const BOUND_R = [
  '(?![\\p{L}\\p{N}])', // end of a word
  '(?<=[\\p{Ll}\\p{N}])(?=\\p{Lu})', // camel hump: zentrixBlue
  '(?<=\\p{Lu})(?=\\p{Lu}\\p{Ll})', // before a capitalised word: ZENTRIXBlue
];
// Digit humps (zentrix500, 2zentrix) only for tokens of 4+ characters: a short token would eat
// CSS units (100vw, 150ms).
const DIGIT_L = '(?<=\\p{N})(?=\\p{L})';
const DIGIT_R = '(?<=\\p{L})(?=\\p{N})';

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `zentrix` → `[zZ][eE]…`, matching any case without the `i` flag. */
function anyCase(w: string): string {
  return [...w]
    .map((c) => {
      const lo = c.toLowerCase();
      const up = c.toUpperCase();
      return lo !== up && [...lo].length === 1 && [...up].length === 1
        ? `[${esc(lo)}${esc(up)}]`
        : esc(c);
    })
    .join('');
}

/** A token's patterns: `all` (global) for `replace`, `once` for `.test`, so no `lastIndex` state leaks. */
interface WordRegex {
  all: RegExp;
  once: RegExp;
}
const WORDS = new Map<string, WordRegex>();
const WORDS_MAX = 1024;

function wordRegex(w: string): WordRegex {
  const hit = WORDS.get(w);
  if (hit) return hit;
  const long = w.length >= 4;
  const left = [...BOUND_L, ...(long ? [DIGIT_L] : [])];
  const right = [
    ...BOUND_R,
    // An all-caps brand before a lowercase run: ZENTRIXapi.
    `(?<=\\p{Lu}{${[...w].length}})(?=\\p{Ll})`,
    ...(long ? [DIGIT_R] : []),
  ];
  // A token spelled only with hex digits (abc, cafe) must never match inside a color literal.
  const notInHex = /^[0-9a-f]+$/i.test(w) ? '(?<!#[0-9a-fA-F]*)' : '';
  const src = `${notInHex}(?:${left.join('|')})${anyCase(w)}(?:${right.join('|')})(?!-gradient)`;
  const re = { all: new RegExp(src, 'gu'), once: new RegExp(src, 'u') };
  if (WORDS.size >= WORDS_MAX) WORDS.clear();
  WORDS.set(w, re);
  return re;
}

function devMode(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const mode = env?.NODE_ENV;
  return mode === 'development' || mode === 'test';
}

/** Phrases removed as literal text (case-insensitive): host forms, the title, headline samples. */
function phrasesOf(scan: DesignScan, host: string): string[] {
  const phrases: string[] = [scan.host, host, scan.title];
  try {
    phrases.push(new URL(scan.url).origin);
  } catch {
    /* url not parseable: skip */
  }
  let samples = 0;
  for (const s of scan.typography.styles) {
    if (samples >= MAX_SAMPLES) break;
    const sample = s.sample?.trim();
    if (!sample || sample.length < 3) continue;
    // A lone common word ("Product") would corrupt ordinary prose, so only multi-word
    // samples and uncommon single words are removed.
    if (/\s/.test(sample) || !isStopWord(sample)) {
      phrases.push(sample);
      samples++;
    }
  }
  return phrases
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && p.length <= MAX_PHRASE)
    .sort((a, b) => b.length - a.length);
}

const COMPILED = new Map<string, RegExp[]>();
const COMPILED_MAX = 8;

/**
 * The ordered patterns for one brand set, compiled once. The cache key is built from exactly the
 * phrases and tokens the patterns are made of, so an edited scan can never hit a stale entry.
 */
function patternsFor(scan: DesignScan, host: string): RegExp[] {
  const phrases = phrasesOf(scan, host);
  const tokens = brandTokens(scan);
  const key = JSON.stringify([phrases, tokens]);
  const hit = COMPILED.get(key);
  if (hit) return hit;
  const patterns = [
    ...phrases.map((p) => new RegExp(esc(p), 'giu')),
    ...tokens.map((t) => wordRegex(t).all),
  ];
  if (COMPILED.size >= COMPILED_MAX) {
    const oldest = COMPILED.keys().next().value;
    if (oldest !== undefined) COMPILED.delete(oldest);
  }
  COMPILED.set(key, patterns);
  return patterns;
}

/**
 * Ethics guardrail, final pass. Removes the host, title, headline samples and brand tokens
 * (case-insensitive, whole words) and throws in dev/test if the host still appears.
 *
 * Works line by line: no pattern ever sees a newline, which is what lets `createStreamSanitizer`
 * cache finished lines. Any error (a pattern that won't compile, the dev-mode host check) is thrown,
 * never swallowed into unsanitized text; callers fail closed.
 */
export function sanitize(text: string, scan: DesignScan): string {
  const host = scan.host.toLowerCase().replace(/^www\./, '');
  const patterns = patternsFor(scan, host);

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

/** An open last line longer than this is re-sanitized only every `LONG_STEP` new characters. */
const LONG_LINE = 512;
const LONG_STEP = 256;

/**
 * Sanitizer for a growing stream (`raw` is the whole text so far, append-only). Finished lines are
 * sanitized once and kept; only the open last line is redone. That is the same result as
 * `sanitize(raw)`, because `sanitize` works per line. A long open line is redone in steps, so a
 * snapshot can lag behind the raw text, but it is always sanitized text, never raw. Callers run a
 * full `sanitize` on the final text. Throws like `sanitize`.
 */
export function createStreamSanitizer(scan: DesignScan): (raw: string) => string {
  let cut = 0; // raw index just past the last newline already sanitized
  let head = ''; // sanitize(raw.slice(0, cut))
  let tailLen = -1; // length of the open line when it was last sanitized
  let tailOut = '';
  return (raw) => {
    if (raw.length < cut) {
      // Not the same stream any more (a retry restarted it): start over.
      cut = 0;
      head = '';
      tailLen = -1;
    }
    const nl = raw.lastIndexOf('\n');
    if (nl + 1 > cut) {
      head += sanitize(raw.slice(cut, nl + 1), scan);
      cut = nl + 1;
      tailLen = -1;
    }
    const tail = raw.length - cut;
    if (tail <= LONG_LINE || tailLen < 0 || tail - tailLen >= LONG_STEP) {
      tailOut = sanitize(raw.slice(cut), scan);
      tailLen = tail;
    }
    return head + tailOut;
  };
}
