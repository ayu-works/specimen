/**
 * One-time scrub of stored Ask history (SPC-26, audit H5). Before SPC-16 a provider error could echo
 * the API key, and the Ask view saved that text to `db.chats`. This removes it once.
 *
 * Keys are read into memory only for the call, never logged, stored or sent. The marker is set only
 * after a run that could read every stored key; with a locked key the shape scrub re-runs on each
 * panel open until it can.
 */
import { scrubLegacyProviderText } from '@specimen/ai';
import { loadKey, SECRET_PREFIX } from './aiSettings';
import { type ChatMessage, db, whenChatsReady } from './db';

export const SCRUB_MARKER = 'migrations.chatScrub';

export type ScrubResult = 'done' | 'partial' | 'skipped' | 'failed';

/** Exact known keys only (verbatim and URL-encoded, 8+ characters): safe on real answers. */
export function redactKnownKeys(text: string, knownKeys: readonly string[]): string {
  let out = text;
  for (const k of knownKeys) {
    if (k.length < 8) continue;
    for (const form of new Set([k, encodeURIComponent(k)]))
      out = out.split(form).join('[redacted]');
  }
  return out;
}

function scrubMessage(m: ChatMessage, keys: readonly string[]): ChatMessage {
  if (m.role !== 'assistant') return m;
  const next: ChatMessage = { ...m, content: redactKnownKeys(m.content, keys) };
  // Error text gets the full legacy scrub (key shapes too); answers only lose exact keys.
  if (m.error !== undefined) next.error = scrubLegacyProviderText(m.error, keys);
  return next;
}

async function readKnownKeys(): Promise<{ keys: string[]; partial: boolean }> {
  const all = await chrome.storage.local.get(null);
  const presets = Object.keys(all)
    .filter((k) => k.startsWith(SECRET_PREFIX))
    .map((k) => k.slice(SECRET_PREFIX.length));
  const keys: string[] = [];
  let partial = false;
  for (const preset of presets) {
    const got = await loadKey(preset);
    if (got.status === 'ok') keys.push(got.key);
    else if (got.status === 'locked') partial = true;
  }
  return { keys, partial };
}

async function run(): Promise<ScrubResult> {
  try {
    const got = await chrome.storage.local.get(SCRUB_MARKER);
    if (got[SCRUB_MARKER] === 1) return 'skipped';
    // Every key is read before the transaction: a non-Dexie await inside it would commit it early.
    const { keys, partial } = await readKnownKeys();
    await db.transaction('rw', db.chats, async () => {
      const rows = await db.chats.toArray();
      for (const row of rows) {
        const messages = row.messages.map((m) => scrubMessage(m, keys));
        if (JSON.stringify(messages) !== JSON.stringify(row.messages))
          await db.chats.put({ scanId: row.scanId, messages });
      }
    });
    if (partial) return 'partial';
    await chrome.storage.local.set({ [SCRUB_MARKER]: 1 });
    return 'done';
  } catch {
    // Nothing is logged: an error here could quote row text. The transaction rolled back; retry next open.
    return 'failed';
  }
}

/** Run the scrub; chat reads and writes wait for it. Safe to call on every panel open. */
export function scrubStoredChats(): Promise<ScrubResult> {
  const p = run();
  whenChatsReady(p);
  return p;
}
