import type { DesignScan } from '@specimen/core/schema';
import { z } from 'zod';
import { type LLMProvider, ProviderError } from '../types';
import { collect, safe } from './collect';
import { compactScan, PAGE_DATA_RULE, pageDataBudget, wrapPageData } from './pageData';

export const VibeSchema = z.object({
  summary: z.string().min(1),
  keywords: z.array(z.string()).default([]),
});
export type Vibe = z.infer<typeof VibeSchema>;

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

/** Providers phrase "this model can't take images" differently; treat these 400s as that. */
const IMAGE_REJECTED =
  /content must be a string|image|vision|multimodal|multi-modal|image_url|unsupported content/i;

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
  const run = (withImage: boolean) =>
    collect(
      provider,
      scan,
      {
        system: withImage ? SYSTEM_IMAGE : SYSTEM_TEXT,
        json: true,
        temperature: 0.4,
        maxTokens: 300,
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
      IMAGE_REJECTED.test(e.message);
    if (!rejected) throw e;
    usedImage = false;
    raw = await run(false);
  }

  const parsed = VibeSchema.safeParse(extractJson(raw));
  const result: Vibe = parsed.success
    ? parsed.data
    : { summary: raw.replace(/[{}"]/g, '').trim().slice(0, 280), keywords: [] };
  if (!result.summary) throw new ProviderError('other', 'The model returned no description.');
  return {
    summary: safe(result.summary, scan).trim() || result.summary,
    keywords: result.keywords
      .map((k) => safe(k, scan).trim())
      .filter(Boolean)
      .slice(0, 8),
    model: provider.id,
    usedImage,
  };
}
