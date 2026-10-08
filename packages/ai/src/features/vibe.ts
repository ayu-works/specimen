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

const SYSTEM = [
  'You describe the visual feel of a website screenshot for a designer.',
  'Reply with a single JSON object: {"summary": string, "keywords": string[]}.',
  '"summary" is one or two sentences on mood, density and style (no brand names, no readable text from the page). "keywords" is 3 to 6 short adjectives.',
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

/** Vision providers only. Falls back to the raw text as the summary when JSON is malformed. */
export async function vibe(
  provider: LLMProvider,
  scan: DesignScan,
  screenshotDataUrl: string,
  signal?: AbortSignal,
): Promise<Vibe & { model: string }> {
  if (!provider.capabilities.vision) {
    throw new ProviderError(
      'unsupported',
      'This model cannot look at images. Choose a vision model.',
    );
  }
  const raw = await collect(
    provider,
    scan,
    {
      system: SYSTEM,
      json: true,
      temperature: 0.4,
      maxTokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe the vibe of this page.' },
            {
              type: 'text',
              text: wrapPageData(
                compactScan(scan),
                pageDataBudget(provider.capabilities.contextTokens),
              ),
            },
            { type: 'image', dataUrl: screenshotDataUrl },
          ],
        },
      ],
    },
    undefined,
    signal,
  );
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
  };
}
