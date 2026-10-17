import { BOUNDS, cutText, type DesignScan } from '@specimen/core/schema';
import { z } from 'zod';
import { IMAGE_REJECTED_TEXT, MID_STREAM_TEXT, TOO_LONG_TEXT } from '../errors';
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
 * A model whose max output is lower rejects it with a 400, and vibe retries with `SMALL_MAX_TOKENS`.
 */
const MAX_TOKENS = 10_000;
const SMALL_MAX_TOKENS = 4096;
/** `httpError`'s generic 400; Gemini's "maxOutputTokens value of 10000 …" lands here, not on TOO_LONG. */
const HTTP_400_PREFIX = 'The provider rejected the request (HTTP 400)';

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
  const quarter = Math.floor(provider.capabilities.contextTokens / 4);
  const run = (a: { withImage: boolean; json: boolean; maxTokens: number }) =>
    collect(
      provider,
      scan,
      {
        system: a.withImage ? SYSTEM_IMAGE : SYSTEM_TEXT,
        json: a.json,
        temperature: 0.4,
        maxTokens: a.maxTokens,
        messages: [
          {
            role: 'user',
            content:
              a.withImage && screenshotDataUrl
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

  /*
   * Each remedy runs at most once, so there are at most 3 calls; the last error is rethrown as is.
   * - cap down: a 400 for the output cap (a model with a smaller max output); it sticks after.
   * - content: an image rejected (HTTP 400) → text-only; an error mid-stream (Groq's JSON-mode
   *   `json_validate_failed`, or an image rejected mid-stream) → text-only and JSON off.
   * Stop, rate limits and a cut-off reply are never retried.
   */
  const attempt = {
    withImage: provider.capabilities.vision && !!screenshotDataUrl,
    json: true,
    maxTokens: Math.min(MAX_TOKENS, quarter),
  };
  let cappedDown = false;
  let contentRetried = false;
  let raw: string;
  for (;;) {
    try {
      raw = await run(attempt);
      break;
    } catch (e) {
      if (!(e instanceof ProviderError) || e.kind !== 'other') throw e;
      const small = Math.min(SMALL_MAX_TOKENS, quarter);
      if (
        !cappedDown &&
        (e.message === TOO_LONG_TEXT || e.message.startsWith(HTTP_400_PREFIX)) &&
        small < attempt.maxTokens
      ) {
        cappedDown = true;
        attempt.maxTokens = small;
      } else if (!contentRetried && e.message === IMAGE_REJECTED_TEXT && attempt.withImage) {
        contentRetried = true;
        attempt.withImage = false;
      } else if (!contentRetried && e.message === MID_STREAM_TEXT) {
        contentRetried = true;
        attempt.withImage = false;
        attempt.json = false;
      } else {
        throw e;
      }
    }
  }
  const usedImage = attempt.withImage;

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
