import type { DesignScan } from '../../schema';
import type { GeneratedFile } from '../common';
import { sanitize } from '../sanitize';
import {
  colorTokens,
  componentRules,
  direction,
  doDont,
  goal,
  layout,
  mobile,
  spacingShape,
  themeTokens,
  typography,
} from './sections';
import { PROMPT_TARGETS, type PromptTarget, targetSection } from './targets';

export { PROMPT_TARGETS, type PromptTarget, TARGET_LABELS } from './targets';

export interface PromptOptions {
  target?: PromptTarget;
}

/** Agent-ready prompt (ARCHITECTURE §6). Pure and deterministic; brand-free by construction. */
export function generatePrompt(scan: DesignScan, opts: PromptOptions = {}): GeneratedFile {
  const target = opts.target && PROMPT_TARGETS.includes(opts.target) ? opts.target : 'generic';
  const body = [
    goal(),
    direction(scan),
    colorTokens(scan),
    themeTokens(scan),
    typography(scan),
    spacingShape(scan),
    layout(scan),
    mobile(scan),
    componentRules(scan),
    doDont(),
    targetSection(target, scan),
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    filename: 'specimen-prompt.md',
    mime: 'text/markdown',
    content: `${sanitize(body, scan)}\n`,
  };
}
