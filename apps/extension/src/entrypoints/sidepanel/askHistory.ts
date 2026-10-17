import type { AskTurn } from '@specimen/ai';
import type { ChatMessage } from '@/lib/db';

/** Shown under an answer the user stopped; also its `error` marker, so it stays out of history. */
export const STOPPED_TEXT = 'Stopped.';

/**
 * The turns replayed to the model: whole question/answer pairs only. An answer with an error
 * (failed, cut off, stopped) or no text drops its question too, so the model never builds on a
 * half answer or sees two questions in a row.
 */
export function askHistory(messages: readonly ChatMessage[]): AskTurn[] {
  const out: AskTurn[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const q = messages[i];
    const a = messages[i + 1];
    if (q?.role !== 'user' || a?.role !== 'assistant') continue;
    if (q.error || !q.content || a.error || !a.content) continue;
    out.push({ role: 'user', content: q.content }, { role: 'assistant', content: a.content });
    i++;
  }
  return out;
}
