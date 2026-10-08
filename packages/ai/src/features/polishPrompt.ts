import type { DesignScan } from '@specimen/core/schema';
import type { LLMProvider } from '../types';
import { collect, safe } from './collect';
import { PAGE_DATA_RULE, pageDataBudget, wrapPageData } from './pageData';

export interface PolishResult {
  /** What to show: the polished text, or the original when `polished` is false. */
  text: string;
  polished: boolean;
  reason?: string;
}

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const PX = /(?<![\w.])-?\d+(?:\.\d+)?px\b/g;

/** Every hex, px value and (known) font name that appears in `text`, normalised for comparison. */
export function measuredValues(text: string, scan: DesignScan): string[] {
  const out = new Set<string>();
  for (const m of text.match(HEX) ?? []) out.add(m.toLowerCase());
  for (const m of text.match(PX) ?? []) out.add(m.toLowerCase());
  const lower = text.toLowerCase();
  for (const f of scan.typography.families) {
    const name = f.name.trim().toLowerCase();
    if (name && lower.includes(name)) out.add(name);
  }
  return [...out];
}

/** Values from `original` that are absent from `output` (empty = preserved). */
export function missingValues(original: string, output: string, scan: DesignScan): string[] {
  const outLower = output.toLowerCase();
  return measuredValues(original, scan).filter((v) => {
    if (v.startsWith('#') || v.endsWith('px')) {
      // Token boundaries so "#fff" doesn't match inside "#ffffff" and "4px" not inside "14px".
      const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`(?<![\\w.#])${escaped}(?![\\w])`).test(outLower);
    }
    return !outLower.includes(v);
  });
}

function stripFence(t: string): string {
  const m = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(t);
  return (m?.[1] ?? t).trim();
}

const SYSTEM = [
  'You rewrite a design-system prompt so it reads smoothly for a coding agent.',
  'Keep the same markdown structure and every measured value exactly as written: every hex color, every px value and every font name. Do not add, remove, round or reformat any number or color.',
  'Do not add brand names, logos or invented facts. Improve flow and clarity only. Output only the rewritten prompt, with no preamble and no code fence.',
  PAGE_DATA_RULE,
].join('\n');

/**
 * Rewrite a generated prompt for readability. If the model drops or changes any measured value
 * the original is returned with `polished: false`. `onText` receives sanitized running snapshots.
 */
export async function polishPrompt(
  provider: LLMProvider,
  scan: DesignScan,
  prompt: string,
  opts: { signal?: AbortSignal; onText?: (text: string) => void } = {},
): Promise<PolishResult> {
  const budget = pageDataBudget(provider.capabilities.contextTokens);
  if (prompt.length > budget) {
    return {
      text: prompt,
      polished: false,
      reason: 'This prompt is too long for the selected model.',
    };
  }
  try {
    const out = await collect(
      provider,
      scan,
      {
        system: SYSTEM,
        messages: [
          { role: 'user', content: `Rewrite this prompt.\n\n${wrapPageData(prompt, budget)}` },
        ],
        temperature: 0.3,
      },
      opts.onText ? (t) => opts.onText?.(stripFence(t)) : undefined,
      opts.signal,
    );
    const text = safe(stripFence(out), scan);
    if (!text) return { text: prompt, polished: false, reason: 'The model returned nothing.' };
    const missing = missingValues(prompt, text, scan);
    if (missing.length > 0) {
      return {
        text: prompt,
        polished: false,
        reason: `The AI changed measured values (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}).`,
      };
    }
    return { text: `${text}\n`, polished: true };
  } catch (e) {
    if ((e as { kind?: string } | null)?.kind === 'aborted') throw e;
    return {
      text: prompt,
      polished: false,
      reason: e instanceof Error ? e.message : 'Polish failed.',
    };
  }
}
