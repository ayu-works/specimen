import type { DesignScan } from '../../schema';
import { kebab, ROLE_ORDER } from '../common';

export const PROMPT_TARGETS = ['generic', 'claude-code', 'cursor', 'v0', 'lovable'] as const;
export type PromptTarget = (typeof PROMPT_TARGETS)[number];

export const TARGET_LABELS: Record<PromptTarget, string> = {
  generic: 'Generic',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  v0: 'v0',
  lovable: 'Lovable',
};

function presentRoles(scan: DesignScan): string[] {
  return ROLE_ORDER.filter((r) => scan.colors.roles[r]).map(kebab);
}

/** The final, target-specific section (wording and stack hints). */
export function targetSection(target: PromptTarget, scan: DesignScan): string {
  const roles = presentRoles(scan);
  const example = roles
    .slice(0, 3)
    .map((r) => `\`--color-${r}\``)
    .join(', ');
  switch (target) {
    case 'claude-code':
      return [
        '## Build instructions (Claude Code)',
        '',
        '- Stack: Next.js (App Router) + Tailwind CSS v4; put tokens in `@theme`; build components in `components/`.',
        `- Declare every color, font, radius and shadow above as an \`@theme\` variable in \`app/globals.css\` (for example ${example}) and style with those utilities only.`,
        '- Create one component per blueprint section, then compose them in `app/page.tsx`. Use placeholder copy and neutral inline-SVG marks.',
        '- Run the dev server and look at the page at desktop and mobile widths.',
        '- Before finishing, compare your page against these values: hex colors, font sizes, radii, spacing and shadows. Fix any drift.',
      ].join('\n');
    case 'cursor':
      return [
        '## Build instructions (Cursor composer)',
        '',
        'Follow these steps in order:',
        '1. Scaffold a Vite or Next.js app with Tailwind CSS; keep all code in `src/`.',
        '2. Add a tokens file (CSS variables or Tailwind theme) holding every value from the tables above. Do not hard-code values elsewhere.',
        '3. Build small components in `src/components/`: Button, Card, Input, Section, Nav, Footer.',
        '4. Assemble the page from the layout blueprint, one section per entry, with original placeholder copy.',
        '5. Review the result against the color, type and spacing tables and correct any mismatch.',
      ].join('\n');
    case 'v0':
      return [
        '## Build instructions (v0)',
        '',
        '- Use shadcn/ui components themed with these tokens.',
        '- Map the color roles onto the shadcn CSS variables (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--radius`) in the global stylesheet, in oklch or hex.',
        '- Use Tailwind utilities for spacing and layout; keep the page responsive down to 375px.',
        '- Use original placeholder copy and simple SVG shapes instead of imagery.',
      ].join('\n');
    case 'lovable':
      return [
        '## Build instructions (Lovable)',
        '',
        '- React + Tailwind; keep it a single-page landing.',
        '- Define the colors, fonts and radii above in the Tailwind theme and the global CSS, and reuse them everywhere.',
        '- Sections follow the layout blueprint in order. Use original placeholder copy and no external images.',
        '- Keep the design responsive and accessible (visible focus states, sufficient contrast).',
      ].join('\n');
    default:
      return [
        '## Build instructions',
        '',
        '- Stack-agnostic: use plain HTML and CSS, or your framework of choice.',
        '- Declare the values above as CSS custom properties on `:root` (for example `--color-accent`, `--radius-button`, `--space-4`) and reference only those variables.',
        '- Build the sections from the layout blueprint in order, with original placeholder copy.',
        '- Check the finished page against the tables above before you stop.',
      ].join('\n');
  }
}
