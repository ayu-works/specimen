import { z } from 'zod';

import { STYLE_KEYS } from './styleKeys';

export { STYLE_KEYS };

export const StyleKeySchema = z.enum(STYLE_KEYS);
export type { StyleKey } from './styleKeys';

const Rect = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const RawSampleSchema = z.object({
  i: z.number().int(),
  tag: z.string(),
  role: z.string().optional(),
  depth: z.number().int(),
  rect: Rect,
  text: z.object({ len: z.number(), snippet: z.string().optional() }).optional(),
  heading: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])
    .optional(),
  interactive: z.enum(['button', 'link', 'input', 'select', 'textarea']).optional(),
  landmark: z.enum(['header', 'nav', 'main', 'footer', 'aside']).optional(),
  section: z.number().int(),
  s: z.partialRecord(StyleKeySchema, z.string()),
});
export type RawSample = z.infer<typeof RawSampleSchema>;

export const RawSectionSchema = z.object({
  index: z.number().int(),
  rect: Rect,
  tag: z.string(),
  landmark: z.enum(['header', 'nav', 'main', 'footer', 'aside']).optional(),
  childCount: z.number().int(),
  display: z.string().optional(),
  gridColumns: z.number().int().optional(),
});
export type RawSection = z.infer<typeof RawSectionSchema>;

export const RawPageSchema = z.object({
  url: z.string(),
  title: z.string(),
  scannedAt: z.number(),
  viewport: z.object({ w: z.number(), h: z.number(), dpr: z.number() }),
  doc: z.object({ w: z.number(), h: z.number() }),
  colorScheme: z.enum(['light', 'dark']),
  rootVars: z.record(z.string(), z.string()),
  mediaQueries: z.array(z.string()),
  fontFaces: z.array(
    z.object({
      family: z.string(),
      src: z.string(),
      weight: z.string().optional(),
      style: z.string().optional(),
    }),
  ),
  loadedFonts: z.array(z.string()),
  samples: z.array(RawSampleSchema),
  sections: z.array(RawSectionSchema),
  warnings: z.array(z.string()),
});
export type RawPage = z.infer<typeof RawPageSchema>;
