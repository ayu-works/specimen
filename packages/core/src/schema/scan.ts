import { z } from 'zod';

export const ColorRoleSchema = z.enum([
  'background',
  'surface',
  'surfaceAlt',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'border',
  'accent',
  'accentHover',
  'accentForeground',
  'link',
  'success',
  'warning',
  'danger',
]);
export type ColorRole = z.infer<typeof ColorRoleSchema>;

export const ColorTokenSchema = z.object({
  id: z.string(),
  hex: z.string(),
  oklch: z.tuple([z.number(), z.number(), z.number()]),
  alpha: z.number(),
  weight: z.number(),
  usage: z.object({ bg: z.number(), text: z.number(), border: z.number(), fill: z.number() }),
  sourceVar: z.string().optional(),
});
export type ColorToken = z.infer<typeof ColorTokenSchema>;

export const TypeStyleSchema = z.object({
  id: z.string(),
  role: z.enum([
    'display',
    'h1',
    'h2',
    'h3',
    'h4',
    'body-lg',
    'body',
    'small',
    'caption',
    'label',
    'button',
    'code',
  ]),
  familyId: z.string(),
  size: z.number(),
  weight: z.number(),
  lineHeight: z.number(),
  letterSpacingEm: z.number(),
  transform: z.enum(['uppercase', 'lowercase', 'capitalize']).optional(),
  weightShare: z.number(),
  sample: z.string().optional(),
});
export type TypeStyle = z.infer<typeof TypeStyleSchema>;

export const SectionSchema = z.object({
  index: z.number().int(),
  kind: z.enum([
    'nav',
    'hero',
    'logos',
    'features',
    'stats',
    'testimonials',
    'pricing',
    'cta',
    'faq',
    'content',
    'footer',
    'unknown',
  ]),
  y: z.number(),
  height: z.number(),
  arrangement: z.enum(['stack', 'split', 'grid', 'bento', 'carousel', 'list']),
  columns: z.number().int(),
  align: z.enum(['left', 'center']),
  bgRole: ColorRoleSchema.optional(),
  headingStyleId: z.string().optional(),
  confidence: z.number(),
});
export type Section = z.infer<typeof SectionSchema>;

export const ComponentSpecSchema = z.object({
  kind: z.enum([
    'button-primary',
    'button-secondary',
    'button-ghost',
    'input',
    'card',
    'nav-link',
    'badge',
  ]),
  base: z.record(z.string(), z.string()),
  states: z.partialRecord(
    z.enum(['hover', 'focus', 'active', 'disabled']),
    z.record(z.string(), z.string()),
  ),
});
export type ComponentSpec = z.infer<typeof ComponentSpecSchema>;

const ColorsSchema = z.object({
  palette: z.array(ColorTokenSchema),
  roles: z.partialRecord(ColorRoleSchema, z.string()),
  gradients: z.array(z.object({ css: z.string(), weight: z.number() })),
});

const LayoutSchema = z.object({
  containerMaxWidth: z.number().nullable(),
  gutter: z.number().nullable(),
  breakpoints: z.array(z.number()),
  density: z.enum(['compact', 'comfortable', 'airy']),
  blueprint: z.array(SectionSchema),
});

/** Layout measured at a phone-width viewport, plus what changes versus desktop. */
const MobileSchema = LayoutSchema.partial().extend({
  /** Type sizes (px, by role) that differ from desktop. */
  typeSizes: z.record(z.string(), z.number()).optional(),
  sectionPaddingY: z.number().optional(),
  /** True when the top navigation collapses into a menu button. */
  hamburger: z.boolean().optional(),
  /** Real viewport width of the capture (browsers enforce a minimum popup width). */
  viewportWidth: z.number().optional(),
});

/** Colors of the other color scheme. `measured` = captured from the page (else derived). */
const ThemeVariantSchema = ColorsSchema.partial().extend({ measured: z.boolean().optional() });

export const FamilySchema = z.object({
  id: z.string(),
  name: z.string(),
  stack: z.string(),
  role: z.enum(['display', 'body', 'mono']),
  source: z.enum(['google', 'adobe', 'self-hosted', 'system', 'unknown']),
  weights: z.array(z.number()),
});

export const DesignScanSchema = z.object({
  schemaVersion: z.literal(3),
  id: z.string(),
  url: z.string(),
  host: z.string(),
  title: z.string(),
  scannedAt: z.number(),
  viewport: z.object({ w: z.number(), h: z.number() }),
  colorScheme: z.enum(['light', 'dark']),
  colors: ColorsSchema,
  typography: z.object({
    families: z.array(FamilySchema),
    styles: z.array(TypeStyleSchema),
    baseSize: z.number(),
    scaleRatio: z.number().nullable(),
  }),
  spacing: z.object({
    baseUnit: z.number(),
    scale: z.array(z.number()),
    sectionPaddingY: z.number(),
    contentGap: z.number(),
  }),
  radii: z.object({
    scale: z.array(z.object({ value: z.number(), weight: z.number() })),
    button: z.number().optional(),
    card: z.number().optional(),
    input: z.number().optional(),
    pillButtons: z.boolean(),
  }),
  shadows: z.array(
    z.object({
      css: z.string(),
      weight: z.number(),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    }),
  ),
  borders: z.array(
    z.object({ width: z.number(), colorRole: ColorRoleSchema.optional(), weight: z.number() }),
  ),
  layout: LayoutSchema,
  motion: z.object({ durationsMs: z.array(z.number()), easings: z.array(z.string()) }).optional(),
  components: z.array(ComponentSpecSchema).optional(),
  variants: z
    .object({
      dark: ThemeVariantSchema.optional(),
      light: ThemeVariantSchema.optional(),
      mobile: MobileSchema.optional(),
    })
    .optional(),
  vibe: z
    .object({ summary: z.string(), keywords: z.array(z.string()), model: z.string() })
    .optional(),
  a11y: z
    .object({
      pairs: z.array(
        z.object({
          fg: z.string(),
          bg: z.string(),
          ratio: z.number(),
          aa: z.boolean(),
          aaLarge: z.boolean(),
          fgRole: ColorRoleSchema.optional(),
          bgRole: ColorRoleSchema.optional(),
          /** `ui` = non-text component (needs 3:1), `text` = needs 4.5:1 (3:1 when large). */
          kind: z.enum(['text', 'ui']).optional(),
          /** Nearest passing foreground (OKLCH lightness shift), when the pair fails. */
          fix: z.string().optional(),
        }),
      ),
    })
    .optional(),
  cssVariables: z.record(z.string(), z.string()),
  meta: z.object({
    extractorVersion: z.string(),
    sampleCount: z.number(),
    durationMs: z.number(),
    warnings: z.array(z.string()),
    pages: z.array(z.string()).optional(),
  }),
});
export type DesignScan = z.infer<typeof DesignScanSchema>;
