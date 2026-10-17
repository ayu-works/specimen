import { BOUNDS, cutText, type DesignScan } from '@specimen/core/schema';
import { z } from 'zod';
import { IMAGE_REJECTED_TEXT } from '../errors';
import { type LLMProvider, ProviderError } from '../types';
import { collect, safe } from './collect';
import { compactScan, PAGE_DATA_RULE, pageDataBudget, wrapPageData } from './pageData';

export const VibeSchema = z.object({
  summary: z.string().min(1),
  // Non-string entries are dropped, not a reason to fall back to the raw reply.
  keywords: z
    .array(z.unknown())
    .default([])
    .transform((a) => a.filter((k): k is string => typeof k === 'string')),
});
export type Vibe = z.infer<typeof VibeSchema>;

export const VIBE_FILTERED = 'The description was filtered (brand names are removed).';

/** Keywords kept, and raw keywords looked at to find them (some may sanitize to nothing). */
const MAX_KEYWORDS = Math.min(8, BOUNDS.keywords);
const RAW_KEYWORDS = 4 * MAX_KEYWORDS;
/**
 * Output cap. The reply is ~100 tokens, but thinking models (Gemini 2.5, gpt-oss) count their
 * thinking against it, so it is generous; at most a quarter of a small context (like critique).
 */
const MAX_TOKENS = 1200;

/**
 * Sanitized `text` within `max` chars (the v5 bound), so `updateScan` accepts it. Only a bounded
 * slice (2 × max) goes through the sanitizer; that cut may split a brand name, so its trailing
 * partial word is dropped. The final cut can also make one ("zentrixology" → "zentrix"), so the
 * cut text is sanitized again (sanitizing only removes text, so it stays within `max`). Fails
 * closed like `safe`: `''`, never raw text.
 */
function clamp(text: string, max: number, scan: DesignScan): string {
  const pre = cutText(text, 2 * max);
  let out = safe(pre, scan);
  if (pre.length < text.length) out = out.replace(/\S*$/, '');
  out = out.trim();
  if (out.length <= max) return out;
  return safe(cutText(out, max), scan).trim();
}

/** Keywords in order, without repeats (sanitizing can make two the same); case-insensitive. */
function unique(keywords: string[]): string[] {
  const seen = new Set<string>();
  return keywords.filter((k) => {
    const key = k.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SYSTEM_IMAGE = [
  'You describe the visual feel of a website screenshot for a designer.',
  'Reply with a single JSON object: {"summary": string, "keywords": string[]}.',
  '"summary" is one or two sentences on mood, density and style (no brand names, no readable text from the page). "keywords" is 3 to 6 short adjectives.',
  PAGE_DATA_RULE,
].join('\n');

const SYSTEM_TEXT = [
  'You describe the visual feel of a website for a designer, using only its measured design values (colors, type scale, spacing, radii, layout).',
  'Reply with a single JSON object: {"summary": string, "keywords": string[]}.',
  '"summary" is one or two sentences on mood, density and style (no brand names). "keywords" is 3 to 6 short adjectives.',
  PAGE_DATA_RULE,
].join('\n');

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Describe the page's vibe. With a vision model and a screenshot, the model looks at the page;
 * otherwise (or if the provider rejects the image) it works from the measured values alone, so
 * text-only models such as local Gemma still get a useful description.
 */
export async function vibe(
  provider: LLMProvider,
  scan: DesignScan,
  screenshotDataUrl: string | null | undefined,
  signal?: AbortSignal,
): Promise<Vibe & { model: string; usedImage: boolean }> {
  const data = wrapPageData(compactScan(scan), pageDataBudget(provider.capabilities.contextTokens));
  const maxTokens = Math.min(MAX_TOKENS, Math.floor(provider.capabilities.contextTokens / 4));
  const run = (withImage: boolean) =>
    collect(
      provider,
      scan,
      {
        system: withImage ? SYSTEM_IMAGE : SYSTEM_TEXT,
        json: true,
        temperature: 0.4,
        maxTokens,
        messages: [
          {
            role: 'user',
            content:
              withImage && screenshotDataUrl
                ? [
                    { type: 'text', text: 'Describe the vibe of this page.' },
                    { type: 'text', text: data },
                    { type: 'image', dataUrl: screenshotDataUrl },
                  ]
                : `Describe the vibe of this page from its measured design values.\n${data}`,
          },
        ],
      },
      undefined,
      signal,
    );

  let usedImage = provider.capabilities.vision && !!screenshotDataUrl;
  let raw: string;
  try {
    raw = await run(usedImage);
  } catch (e) {
    const rejected =
      usedImage &&
      e instanceof ProviderError &&
      e.kind === 'other' &&
      e.message === IMAGE_REJECTED_TEXT;
    if (!rejected) throw e;
    usedImage = false;
    raw = await run(false);
  }

  const parsed = VibeSchema.safeParse(extractJson(raw));
  const result: Vibe = parsed.success
    ? parsed.data
    : { summary: cutText(raw.replace(/[{}"]/g, '').trim(), 280), keywords: [] };
  if (!result.summary) throw new ProviderError('other', 'The model returned no description.');
  // Fail closed: a summary the brand filter empties (or can't process) is never shown raw.
  const summary = clamp(result.summary, BOUNDS.vibeSummary, scan);
  if (!summary) throw new ProviderError('other', VIBE_FILTERED);
  return {
    summary,
    keywords: unique(
      result.keywords
        .slice(0, RAW_KEYWORDS)
        .map((k) => clamp(k, BOUNDS.keyword, scan))
        .filter(Boolean),
    ).slice(0, MAX_KEYWORDS),
    model: provider.id,
    usedImage,
  };
}
