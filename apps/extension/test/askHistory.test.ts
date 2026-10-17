import { describe, expect, it } from 'vitest';
import {
  askHistory,
  NO_ANSWER_STUB,
  STOPPED_STUB,
  STOPPED_TEXT,
} from '../src/entrypoints/sidepanel/askHistory';
import type { ChatMessage } from '../src/lib/db';

const q = (content: string): ChatMessage => ({ role: 'user', content });
const a = (content: string, error?: string): ChatMessage =>
  error ? { role: 'assistant', content, error } : { role: 'assistant', content };
const pair = (question: string, answer: string) => [
  { role: 'user', content: question },
  { role: 'assistant', content: answer },
];

describe('askHistory', () => {
  it('T3.12 keeps whole question/answer pairs in order', () => {
    expect(askHistory([q('one'), a('1'), q('two'), a('2')])).toEqual([
      ...pair('one', '1'),
      ...pair('two', '2'),
    ]);
  });

  it('T3.12 a stopped, failed, cut-off or empty answer keeps its question with a fixed stub, never its partial text', () => {
    const turns = askHistory([
      q('stopped'),
      a('half stopped', STOPPED_TEXT),
      q('failed'),
      a('', 'Rate limited.'),
      q('cut'),
      a('half cut', 'The answer hit the length limit and was cut off.'),
      q('empty'),
      a(''),
      q('kept'),
      a('ok'),
    ]);
    expect(turns).toEqual([
      ...pair('stopped', STOPPED_STUB),
      ...pair('failed', NO_ANSWER_STUB),
      ...pair('cut', NO_ANSWER_STUB),
      ...pair('empty', NO_ANSWER_STUB),
      ...pair('kept', 'ok'),
    ]);
    expect(JSON.stringify(turns)).not.toContain('half');
  });

  it('T3.12 turns always alternate: a trailing question, a lone answer, or two questions in a row never go in', () => {
    const turns = askHistory([a('orphan'), q('one'), q('two'), a('2'), q('pending')]);
    expect(turns).toEqual(pair('two', '2'));
    expect(askHistory([])).toEqual([]);
  });
});
