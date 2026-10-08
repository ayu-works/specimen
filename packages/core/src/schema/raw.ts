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

export const RawComponentSchema = z.object({
  kind: z.enum([
    'button-primary',
    'button-secondary',
    'button-ghost',
    'input',
    'card',
    'nav-link',
    'badge',
  ]),
  /** Computed styles (kebab-case property names). */
  base: z.record(z.string(), z.string()),
  /** Declared property overrides from `:hover`, `:focus`, `:active` and `:disabled` rules. */
  states: z.partialRecord(
    z.enum(['hover', 'focus', 'active', 'disabled']),
    z.record(z.string(), z.string()),
  ),
});
export type RawComponent = z.infer<typeof RawComponentSchema>;

/** Page-level facts the sampler can read cheaply and the pure extractors cannot. */
export const RawHintsSchema = z.object({
  /** Visible menu button in the top bar (hamburger). */
  hamburger: z.boolean().optional(),
  /** Visible links in the top bar. */
  navLinks: z.number().optional(),
  /** Theme switches the page declares: `class:dark`, `attr:data-theme=dark`, ... */
  darkSelectors: z.array(z.string()).optional(),
  lightSelectors: z.array(z.string()).optional(),
  /** The page has `@media (prefers-color-scheme)` rules. */
  prefersScheme: z.boolean().optional(),
  /** Set on a themed re-sample: did toggling the class/attribute change anything? */
  themeApplied: z.boolean().optional(),
});
export type RawHints = z.infer<typeof RawHintsSchema>;

export const RawPageSchema = z.object({
  url: z.string(),
  title: z.string(),
  scannedAt: z.number(),
  viewport: z.object({ w: z.number(), h: z.number(), dpr: z.number() }),
  doc: z.object({ w: z.number(), h: z.number() }),
  colorScheme: z.enum(['light', 'dark']),
  /** Computed background of <html> (the canvas), when the page sets one. */
  canvasBg: z.string().optional(),
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
  /** Phase 5: representative interactive elements and cards with their state rules. */
  components: z.array(RawComponentSchema).optional(),
  hints: RawHintsSchema.optional(),
  warnings: z.array(z.string()),
});
export type RawPage = z.infer<typeof RawPageSchema>;
