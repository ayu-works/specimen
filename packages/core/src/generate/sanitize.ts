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
  return STOP.has(foldText(w).toLowerCase());
}

// Unicode folding (SPC-31). Brands and text are both matched on a "skeleton": letters, digits and
// spaces get NFKD with the generic combining diacritics (Script=Inherited) dropped, plus the full
// case folds NFKD lacks; format characters (\p{Cf}: soft hyphen, zero-width space) are dropped. Case
// is kept, so the case boundaries below still work: `ZÉNTRIXBlue` → `ZENTRIXBlue`, `Straße` →
// `Strasse`, `İ` → `I`, `Ｚｅｎ` → `Zen`, `ﬁ` → `fi`. Symbols stay as they are, so `™` (NFKD `TM`) is
// still a boundary, and script vowel signs (Devanagari `ा`, Thai) are spelling, so they stay too.
// Cross-script look-alikes (Cyrillic `е`) are not folded.
const FOLD_EXTRA: Record<string, string> = { ß: 'ss', ẞ: 'SS', ς: 'σ', ı: 'i' };
const FOLDS = new Map<string, string>();
const FOLDS_MAX = 4096;
const NON_ASCII = /\P{ASCII}/u;
const FOLDABLE = /[\p{L}\p{M}\p{Nd}\p{Zs}]/u;
const DIACRITIC = /(?=\p{M})\p{Script=Inherited}/gu;
const isMark = (c: string | undefined) => !!c && /\p{M}/u.test(c);

function foldChar(c: string): string {
  if (c.charCodeAt(0) < 0x80) return c;
  const extra = FOLD_EXTRA[c];
  if (extra !== undefined) return extra;
  let f = FOLDS.get(c);
  if (f === undefined) {
    // Diacritics and invisible format characters have width 0.
    f = /\p{Cf}/u.test(c) ? '' : FOLDABLE.test(c) ? c.normalize('NFKD').replace(DIACRITIC, '') : c;
    if (FOLDS.size >= FOLDS_MAX) FOLDS.clear();
    FOLDS.set(c, f);
  }
  return f;
}

/** The case-preserving skeleton of `s` (ASCII comes back as is). */
export function foldText(s: string): string {
  if (!NON_ASCII.test(s)) return s;
  let out = '';
  for (const c of s) out += foldChar(c);
  return out;
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
/** Only the first and the last this-many title characters are read for brand tokens. */
export const TITLE_SCAN = 300;
/** Tokens kept from the start of the title (patterns are compiled once, so this can be generous). */
export const MAX_TITLE_TOKENS = 32;
/** Tokens kept from the end of a title longer than `TITLE_SCAN` ("… - Zentrix Official Store"). */
export const MAX_TAIL_TOKENS = 6;
/**
 * A title segment (split on `|`, `–`, `—`, `·`, `:`, `•` or a spaced hyphen) of at most this many
 * words is usually a name ("… | Zentrix | …"): all its tokens are kept, wherever it sits.
 */
export const SEGMENT_WORDS = 3;
/** At most this many tokens from short segments. */
export const MAX_SEGMENT_TOKENS = 16;
/** Longer tokens are dropped: a DNS label is at most 63 characters, so no real domain is lost. */
export const MAX_TOKEN = 64;
/** Longer phrases (title, headline samples) are skipped; their words are still tokens. */
export const MAX_PHRASE = 1000;
/** At most this many headline samples are removed as phrases. */
export const MAX_SAMPLES = 50;

const isToken = (w: string) => w.length >= 3 && w.length <= MAX_TOKEN && !isStopWord(w);
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const SEGMENT = /\s[-–—]\s|[|–—·:•]/u;

/** Distinct tokens of a title window, in order. */
function titleTokens(win: string): string[] {
  return [...new Set(words(win).filter(isToken))];
}

/** Tokens of the window's short segments (likely names), in order. */
function segmentTokens(win: string): string[] {
  return win.split(SEGMENT).flatMap((seg) => {
    const ws = words(seg);
    return ws.length <= SEGMENT_WORDS ? ws.filter(isToken) : [];
  });
}

/** Lower-cased brand tokens derived from the host and the page title. */
export function brandTokens(scan: Pick<DesignScan, 'host' | 'title'>): string[] {
  const set = new Set<string>();
  const sld = secondLevel(foldText(scan.host));
  if (sld.length >= 2 && sld.length <= MAX_TOKEN) set.add(sld);
  for (const piece of sld.split(/[^\p{L}\p{N}]+/u)) {
    if (isToken(piece)) set.add(piece);
  }
  const t = scan.title;
  // The two windows; a word cut at a window edge is a fragment, so it is trimmed off.
  let head = t.slice(0, TITLE_SCAN);
  if (isWordChar(t[TITLE_SCAN])) head = head.replace(/[\p{L}\p{N}]+$/u, '');
  const from = Math.max(0, t.length - TITLE_SCAN);
  let tail = t.slice(from);
  if (isWordChar(t[from - 1])) tail = tail.replace(/^[\p{L}\p{N}]+/u, '');
  head = foldText(head);
  tail = foldText(tail);
  for (const w of titleTokens(head).slice(0, MAX_TITLE_TOKENS)) set.add(w);
  if (from > 0) for (const w of titleTokens(tail).slice(-MAX_TAIL_TOKENS)) set.add(w);
  const segs = [...segmentTokens(head), ...(from > 0 ? segmentTokens(tail) : [])];
  for (const w of [...new Set(segs)].slice(0, MAX_SEGMENT_TOKENS)) set.add(w);
  return [...set].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** Case is kept: a camelCase hump (`zentrixBlue`) is a boundary, so lower-casing would hide it. */
export function containsBrand(text: string, tokens: string[]): boolean {
  const sk = foldText(text);
  return wordRegexes(tokens).some((re) => {
    re.lastIndex = 0; // global regexes, shared through the cache
    return re.test(sk);
  });
}

/**
 * True when a CSS variable name carries a brand token: at a word, case or digit boundary, or (for
 * tokens of 4+ characters) anywhere, since `--zentrixblue` has no boundary at all. Short tokens
 * (`hp`) need a boundary, or `--php-version` would match.
 */
export function nameHasBrand(name: string, tokens: string[]): boolean {
  const lower = foldText(name).toLowerCase();
  return tokens.some((b) => b.length >= 4 && lower.includes(b)) || containsBrand(name, tokens);
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

// CSS words a brand token must not be cut out of: `linear-gradient` (any token), and the `box-*`
// properties (only the token `box`, so `zentrix-shadow` in prose still loses the brand).
const KEEP_AFTER = '-gradient';
const KEEP_AFTER_BOX = '-(?:gradient|shadow|sizing|decoration-break)';

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

// Unicode property classes (\p{L}, \p{Lu}, …) make a regex cost ~1.5 ms to compile, so words are
// not compiled one regex each: all words that share the same rules go into one alternation.
const LU = /^\p{Lu}+$/u;

/** One regex for a group of words that share the rules (`long`: 4+ chars; `hex`: only hex digits). */
function groupRegex(ws: string[], long: boolean, hex: boolean, box: boolean): RegExp {
  const left = [...BOUND_L, ...(long ? [DIGIT_L] : [])];
  const right = [...BOUND_R, ...(long ? [DIGIT_R] : [])];
  // An all-caps brand before a lowercase run: ZENTRIXapi.
  const caps = ws.map((w) => w.toUpperCase()).filter((u) => LU.test(u));
  const capsBranch = caps.length ? `(?:${caps.map(esc).join('|')})(?=\\p{Ll})|` : '';
  // A word spelled only with hex digits (abc, cafe) must never match inside a color literal.
  const notInHex = hex ? '(?<!#[0-9a-fA-F]*)' : '';
  const src = `${notInHex}(?:${left.join('|')})(?:${capsBranch}(?:${ws.map(anyCase).join('|')})(?:${right.join('|')}))(?!${box ? KEEP_AFTER_BOX : KEEP_AFTER})`;
  return new RegExp(src, 'gu');
}

const GROUPS = new Map<string, RegExp[]>();
const GROUPS_MAX = 64;

/**
 * Whole-word patterns for a word list (brand tokens, one-word phrases), any case, at word, case or
 * digit boundaries. At most four regexes whatever the list's length. Cached by the list; the
 * regexes are global, so callers that `.test` reset `lastIndex` first.
 */
function wordRegexes(list: string[]): RegExp[] {
  const ws = [...new Set(list.map(foldText))].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
  const key = ws.join('\u0000');
  const hit = GROUPS.get(key);
  if (hit) return hit;
  const groups = new Map<string, string[]>();
  for (const w of ws) {
    const k = `${w.length >= 4 ? 'L' : 's'}${/^[0-9a-f]+$/i.test(w) ? 'h' : ''}${w.toLowerCase() === 'box' ? 'b' : ''}`;
    groups.set(k, [...(groups.get(k) ?? []), w]);
  }
  const res = [...groups].flatMap(([k, g]) =>
    chunks(g, (w) => anyCase(w).length).map((c) =>
      groupRegex(c, k[0] === 'L', k.includes('h'), k.includes('b')),
    ),
  );
  if (GROUPS.size >= GROUPS_MAX) GROUPS.clear();
  GROUPS.set(key, res);
  return res;
}

function devMode(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const mode = env?.NODE_ENV;
  return mode === 'development' || mode === 'test';
}

/** Host forms, removed as literal text (case-insensitive) wherever they appear. */
function hostPhrasesOf(scan: DesignScan, host: string): string[] {
  const phrases: string[] = [scan.host, host];
  try {
    phrases.push(new URL(scan.url).origin);
  } catch {
    /* url not parseable: skip */
  }
  return capPhrases(phrases);
}

/**
 * The title and headline samples, removed only as whole words: a title "Cafe" must not turn
 * `#cafe00` into `#00`, nor a sample "Box" eat `box-shadow`.
 */
function textPhrasesOf(scan: DesignScan): string[] {
  const phrases: string[] = [scan.title];
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
  return capPhrases(phrases);
}

function capPhrases(phrases: string[]): string[] {
  return phrases
    .map((p) => foldText(p).trim())
    .filter((p) => p.length >= 3 && p.length <= MAX_PHRASE)
    .sort((a, b) => b.length - a.length);
}

/** Multi-word phrases, longest first, a non-letter on both sides: one regex per chunk. */
function phrasesRegexes(ps: string[]): RegExp[] {
  return chunks(ps, (p) => esc(p).length).map(
    (c) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${c.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'giu'),
  );
}

/**
 * Source size per regex. V8's hard limit is on one literal run (~32k chars, which `MAX_PHRASE` keeps
 * far away); measured, a 150k-char alternation of 1000-char words still compiles. Chunking just keeps
 * any one regex's compile bounded.
 */
const CHUNK_SOURCE = 8000;

/** Consecutive runs of `items` whose summed source size is at most `CHUNK_SOURCE` (one item at least). */
function chunks<T>(items: T[], size: (x: T) => number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let n = 0;
  for (const x of items) {
    const k = size(x) + 1;
    if (cur.length && n + k > CHUNK_SOURCE) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(x);
    n += k;
  }
  if (cur.length) out.push(cur);
  return out;
}

const COMPILED = new Map<string, RegExp[]>();
const COMPILED_MAX = 8;

/**
 * The ordered patterns for one brand set, compiled once. The cache key is built from exactly the
 * phrases and tokens the patterns are made of, so an edited scan can never hit a stale entry.
 */
function patternsFor(scan: DesignScan, host: string): RegExp[] {
  const hosts = hostPhrasesOf(scan, host);
  const texts = textPhrasesOf(scan);
  const tokens = brandTokens(scan);
  const key = JSON.stringify([hosts, texts, tokens]);
  const hit = COMPILED.get(key);
  if (hit) {
    // Most recently used goes last, so eviction drops the least recently used.
    COMPILED.delete(key);
    COMPILED.set(key, hit);
    return hit;
  }
  // Host forms, then multi-word phrases, then words: a phrase goes before the words inside it. A
  // one-word title or sample gets the token rules (case and digit humps, the hex guard).
  const multi = texts.filter((p) => /\s/.test(p));
  const patterns = [
    ...hosts.map((p) => new RegExp(esc(p), 'giu')),
    ...phrasesRegexes(multi),
    ...wordRegexes([...texts.filter((p) => !/\s/.test(p)), ...tokens]),
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
  const host = hostOf(scan);
  return sanitizeWith(text, host, patternsFor(scan, host));
}

const hostOf = (scan: DesignScan) => scan.host.toLowerCase().replace(/^www\./, '');

function sanitizeWith(text: string, host: string, patterns: RegExp[]): string {
  const result = text
    .split('\n')
    .map((line) => stripLine(line, patterns))
    .join('\n');

  if (host.length >= 3 && foldText(result).toLowerCase().includes(host)) {
    if (devMode()) throw new Error('sanitize: host still present in generated output');
    const re = [new RegExp(esc(host), 'gi')];
    return result
      .split('\n')
      .map((line) => stripLine(line, re))
      .join('\n');
  }
  return result;
}

/** Removes every match of each pattern in turn (a later pattern sees the earlier cuts). */
function stripLine(line: string, patterns: RegExp[]): string {
  let cur = line;
  let hit = false;
  if (!NON_ASCII.test(line)) {
    for (const re of patterns) {
      const next = cur.replace(re, '');
      if (next !== cur) hit = true;
      cur = next;
    }
  } else {
    const r = stripFolded(line, patterns);
    hit = r !== line;
    cur = r;
  }
  return hit ? cur.replace(/(\S) {2,}(?=\S)/g, '$1 ').replace(/\( +/g, '(') : cur;
}

/**
 * The same as the ASCII loop, but the patterns run on the line's skeleton and each match removes
 * the original code points it came from: whole code points only (a match edge inside `ß` → `ss`
 * takes the `ß`), and a removed letter takes its combining marks with it. Linear per pattern.
 */
function stripFolded(line: string, patterns: RegExp[]): string {
  const cps = [...line];
  const width = cps.map((c) => foldChar(c).length);
  const gone = new Uint8Array(cps.length);
  // Skeleton of the code points still present, and each skeleton unit's code point.
  const build = () => {
    let sk = '';
    const src: number[] = [];
    cps.forEach((c, i) => {
      if (gone[i] || !width[i]) return;
      sk += foldChar(c);
      for (let k = 0; k < (width[i] ?? 0); k++) src.push(i);
    });
    return { sk, src };
  };
  let { sk, src } = build();
  for (const re of patterns) {
    let cut = false;
    for (const m of sk.matchAll(re)) {
      const end = m.index + m[0].length;
      if (end === m.index) continue;
      const first = src[m.index] ?? 0;
      const last = src[end - 1] ?? first;
      for (let i = first; i <= last; i++) gone[i] = 1;
      // Diacritics after the cut belong to it; format characters there (a closing bidi control,
      // a joiner) stay. Inside the cut, both go.
      for (let i = last + 1; i < cps.length && !width[i] && isMark(cps[i]); i++) gone[i] = 1;
      cut = true;
    }
    if (cut) ({ sk, src } = build());
  }
  return cps.filter((_, i) => !gone[i]).join('');
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
  // Patterns are looked up once per stream, not per delta (building the cache key isn't free).
  const host = hostOf(scan);
  const patterns = patternsFor(scan, host);
  const run = (text: string) => sanitizeWith(text, host, patterns);
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
      head += run(raw.slice(cut, nl + 1));
      cut = nl + 1;
      tailLen = -1;
    }
    const tail = raw.length - cut;
    if (tail <= LONG_LINE || tailLen < 0 || tail - tailLen >= LONG_STEP) {
      tailOut = run(raw.slice(cut));
      tailLen = tail;
    }
    return head + tailOut;
  };
}
