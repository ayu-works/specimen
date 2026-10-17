import { describe, expect, it } from 'vitest';
import { askHistory, STOPPED_TEXT } from '../src/entrypoints/sidepanel/askHistory';
import type { ChatMessage } from '../src/lib/db';

const q = (content: string): ChatMessage => ({ role: 'user', content });
const a = (content: string, error?: string): ChatMessage =>
  error ? { role: 'assistant', content, error } : { role: 'assistant', content };

describe('askHistory', () => {
  it('T3.12 keeps whole question/answer pairs in order', () => {
    expect(askHistory([q('one'), a('1'), q('two'), a('2')])).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: '1' },
      { role: 'user', content: 'two' },
      { role: 'assistant', content: '2' },
    ]);
  });

  it('T3.12 a failed, cut-off, stopped or empty answer drops its question too', () => {
    const turns = askHistory([
      q('failed'),
      a('', 'Rate limited.'),
      q('cut'),
      a('half', 'The answer hit the length limit and was cut off.'),
      q('stopped'),
      a('half', STOPPED_TEXT),
      q('empty'),
      a(''),
      q('kept'),
      a('ok'),
    ]);
    expect(turns).toEqual([
      { role: 'user', content: 'kept' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('T3.12 a trailing unanswered question, a lone answer, or two questions in a row never go in', () => {
    expect(askHistory([a('orphan'), q('one'), q('two'), a('2'), q('pending')])).toEqual([
      { role: 'user', content: 'two' },
      { role: 'assistant', content: '2' },
    ]);
    expect(askHistory([])).toEqual([]);
  });
});
