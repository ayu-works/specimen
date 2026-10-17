import type { AskTurn } from '@specimen/ai';
import type { ChatMessage } from '@/lib/db';

/** Shown under an answer the user stopped; also its `error` marker, so it stays out of history. */
export const STOPPED_TEXT = 'Stopped.';

/** Replayed in place of an answer the user stopped: the question keeps its context, the half text never goes back. */
export const STOPPED_STUB = '(The user stopped this answer before it finished.)';
/** Replayed in place of an answer that failed, was cut off or came back empty. */
export const NO_ANSWER_STUB = '(No complete answer: the request failed or was cut off.)';

/**
 * The turns replayed to the model: question/answer pairs only, so turns always alternate. A
 * failed, cut-off, stopped or empty answer is replaced by a fixed stub, never its partial text,
 * so the model keeps the question ("shorter", "try again" still make sense) but never builds on
 * a half answer. A question with no answer after it, or an answer with no question, is left out.
 */
export function askHistory(messages: readonly ChatMessage[]): AskTurn[] {
  const out: AskTurn[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const q = messages[i];
    const a = messages[i + 1];
    if (q?.role !== 'user' || a?.role !== 'assistant') continue;
    i++;
    if (q.error || !q.content) continue;
    const answer =
      a.error === STOPPED_TEXT ? STOPPED_STUB : a.error || !a.content ? NO_ANSWER_STUB : a.content;
    out.push({ role: 'user', content: q.content }, { role: 'assistant', content: answer });
  }
  return out;
}
