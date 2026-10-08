import type { DesignScan } from '@specimen/core/schema';
import type { LLMProvider } from '../types';
import { collect } from './collect';
import { compactScan, PAGE_DATA_RULE, pageDataBudget, wrapPageData } from './pageData';

export interface AskTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** System prompt for grounded Q&A. Exported so tests can inspect the grounding. */
export function askSystemPrompt(
  provider: Pick<LLMProvider, 'capabilities'>,
  scan: DesignScan,
): string {
  return [
    'You are a design-system analyst. Answer questions about one website using only the measured data below.',
    'Answer from the data. If something was not measured (for example hover states, animations or exact copy), say so plainly instead of guessing. Quote exact hex and px values when relevant. Be concise.',
    'Do not name the website or its brand.',
    PAGE_DATA_RULE,
    wrapPageData(compactScan(scan), pageDataBudget(provider.capabilities.contextTokens)),
  ].join('\n\n');
}

const MAX_HISTORY = 12;

/**
 * Grounded Q&A. `onText` receives sanitized running snapshots of the answer; the promise resolves
 * to the final text.
 */
export function ask(
  provider: LLMProvider,
  scan: DesignScan,
  question: string,
  history: AskTurn[] = [],
  opts: { signal?: AbortSignal; onText?: (text: string) => void } = {},
): Promise<string> {
  return collect(
    provider,
    scan,
    {
      system: askSystemPrompt(provider, scan),
      messages: [
        ...history.slice(-MAX_HISTORY),
        { role: 'user', content: question.slice(0, 2000) },
      ],
      temperature: 0.4,
    },
    opts.onText,
    opts.signal,
  );
}
