import { z } from 'zod';
import { BOUNDS, dict, list, str } from './bounds';

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

/** Lower-case `#rrggbb`, as the extractor writes it (alpha lives in its own field). */
/** Bounded by its pattern; deliberately not in `MAX`, so a long hex is rejected, never trimmed into shape. */
export const HexSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'expected #rrggbb');

export const ColorTokenSchema = z.object({
  id: str(),
  hex: HexSchema,
  oklch: z.tuple([z.number(), z.number(), z.number()]),
  alpha: z.number(),
  weight: z.number(),
  usage: z.object({ bg: z.number(), text: z.number(), border: z.number(), fill: z.number() }),
  sourceVar: str().optional(),
});
export type ColorToken = z.infer<typeof ColorTokenSchema>;

export const TypeStyleSchema = z.object({
  id: str(),
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
  familyId: str(),
  size: z.number(),
  weight: z.number(),
  lineHeight: z.number(),
  letterSpacingEm: z.number(),
  transform: z.enum(['uppercase', 'lowercase', 'capitalize']).optional(),
  weightShare: z.number(),
  sample: str(BOUNDS.sample).optional(),
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
  headingStyleId: str().optional(),
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
  base: dict(str(), str()),
  states: z.partialRecord(z.enum(['hover', 'focus', 'active', 'disabled']), dict(str(), str())),
});
export type ComponentSpec = z.infer<typeof ComponentSpecSchema>;

const ColorsSchema = z.object({
  palette: list(ColorTokenSchema, BOUNDS.palette),
  roles: z.partialRecord(ColorRoleSchema, str()),
  gradients: list(z.object({ css: str(), weight: z.number() })),
});

const LayoutSchema = z.object({
  containerMaxWidth: z.number().nullable(),
  gutter: z.number().nullable(),
  breakpoints: list(z.number()),
  density: z.enum(['compact', 'comfortable', 'airy']),
  blueprint: list(SectionSchema, BOUNDS.blueprint),
});

/** Layout measured at a phone-width viewport, plus what changes versus desktop. */
const MobileSchema = LayoutSchema.partial().extend({
  /** Type sizes (px, by role) that differ from desktop. */
  typeSizes: dict(str(), z.number()).optional(),
  sectionPaddingY: z.number().optional(),
  /** True when the top navigation collapses into a menu button. */
  hamburger: z.boolean().optional(),
  /** Real viewport width of the capture (browsers enforce a minimum popup width). */
  viewportWidth: z.number().optional(),
});

/** Colors of the other color scheme. `measured` = captured from the page (else derived). */
const ThemeVariantSchema = ColorsSchema.partial().extend({ measured: z.boolean().optional() });

export const FamilySchema = z.object({
  id: str(),
  name: str(),
  stack: str(),
  role: z.enum(['display', 'body', 'mono']),
  source: z.enum(['google', 'adobe', 'self-hosted', 'system', 'unknown']),
  weights: list(z.number()),
});

const DesignScanObject = z.object({
  schemaVersion: z.literal(5),
  id: str(),
  url: str(BOUNDS.url),
  host: str(BOUNDS.host),
  title: str(BOUNDS.title),
  scannedAt: z.number(),
  viewport: z.object({ w: z.number(), h: z.number() }),
  colorScheme: z.enum(['light', 'dark']),
  colors: ColorsSchema,
  typography: z.object({
    families: list(FamilySchema, BOUNDS.families),
    styles: list(TypeStyleSchema, BOUNDS.styles),
    baseSize: z.number(),
    scaleRatio: z.number().nullable(),
  }),
  spacing: z.object({
    baseUnit: z.number(),
    scale: list(z.number()),
    sectionPaddingY: z.number(),
    contentGap: z.number(),
  }),
  radii: z.object({
    scale: list(z.object({ value: z.number(), weight: z.number() })),
    button: z.number().optional(),
    card: z.number().optional(),
    input: z.number().optional(),
    pillButtons: z.boolean(),
  }),
  shadows: list(
    z.object({
      css: str(),
      weight: z.number(),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    }),
  ),
  borders: list(
    z.object({ width: z.number(), colorRole: ColorRoleSchema.optional(), weight: z.number() }),
  ),
  layout: LayoutSchema,
  motion: z.object({ durationsMs: list(z.number()), easings: list(str()) }).optional(),
  components: list(ComponentSpecSchema).optional(),
  variants: z
    .object({
      dark: ThemeVariantSchema.optional(),
      light: ThemeVariantSchema.optional(),
      mobile: MobileSchema.optional(),
    })
    .optional(),
  vibe: z
    .object({
      summary: str(BOUNDS.vibeSummary),
      keywords: list(str(BOUNDS.keyword), BOUNDS.keywords),
      model: str(),
    })
    .optional(),
  a11y: z
    .object({
      pairs: list(
        z.object({
          fg: str(),
          bg: str(),
          ratio: z.number(),
          aa: z.boolean(),
          aaLarge: z.boolean(),
          fgRole: ColorRoleSchema.optional(),
          bgRole: ColorRoleSchema.optional(),
          /** `ui` = non-text component (needs 3:1), `text` = needs 4.5:1 (3:1 when large). */
          kind: z.enum(['text', 'ui']).optional(),
          /** Nearest passing foreground (OKLCH lightness shift), when the pair fails. */
          fix: str().optional(),
        }),
      ),
    })
    .optional(),
  cssVariables: dict(str(BOUNDS.cssVarKey), str(BOUNDS.cssVarValue), BOUNDS.cssVariables),
  meta: z.object({
    extractorVersion: str(),
    sampleCount: z.number(),
    durationMs: z.number(),
    warnings: list(str(BOUNDS.warning), BOUNDS.warnings),
    pages: list(str(BOUNDS.url), BOUNDS.pages).optional(),
  }),
});

type Roles = Partial<Record<ColorRole, string>>;

/** Role entries whose id isn't in `palette` (the generators would silently drop them). */
export function danglingRoles(roles: Roles, palette: readonly { id: string }[]): ColorRole[] {
  const ids = new Set(palette.map((t) => t.id));
  return (Object.entries(roles) as [ColorRole, string | undefined][])
    .filter(([, id]) => id !== undefined && !ids.has(id))
    .map(([r]) => r);
}

/**
 * v4: every role points at a palette id. A theme variant's roles point into its own palette, or into
 * the base palette when it has none (the same lookup `roleColors` uses).
 */
export const DesignScanSchema = DesignScanObject.superRefine((scan, ctx) => {
  for (const r of danglingRoles(scan.colors.roles, scan.colors.palette)) {
    ctx.addIssue({
      code: 'custom',
      path: ['colors', 'roles', r],
      message: 'role id not in palette',
    });
  }
  for (const key of ['dark', 'light'] as const) {
    const v = scan.variants?.[key];
    if (!v?.roles) continue;
    for (const r of danglingRoles(v.roles, v.palette ?? scan.colors.palette)) {
      ctx.addIssue({
        code: 'custom',
        path: ['variants', key, 'roles', r],
        message: 'role id not in palette',
      });
    }
  }
});
export type DesignScan = z.infer<typeof DesignScanSchema>;
