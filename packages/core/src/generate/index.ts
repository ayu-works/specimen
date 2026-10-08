import type { DesignScan } from '../schema';
import type { GeneratedFile } from './common';
import { generateCssVars } from './cssvars';
import { generateDesignMd } from './designmd';
import { generateDtcg } from './dtcg';
import { generateFigma } from './figma';
import { generatePrompt, type PromptTarget } from './prompt';
import { generateShadcn } from './shadcn';
import { generateTailwindV3, generateTailwindV4 } from './tailwind';

export type { GeneratedFile } from './common';
export { generateCssVars } from './cssvars';
export { generateDesignMd } from './designmd';
export { generateDtcg } from './dtcg';
export { generateFigma } from './figma';
export {
  generatePrompt,
  PROMPT_TARGETS,
  type PromptOptions,
  type PromptTarget,
  TARGET_LABELS,
} from './prompt';
export { brandTokens, sanitize } from './sanitize';
export { generateShadcn } from './shadcn';
export { generateTailwindV3, generateTailwindV4 } from './tailwind';

export interface GenerateOptions {
  /** Prompt target (only used by the `prompt` generator). */
  target?: PromptTarget;
}

export type GeneratorId =
  | 'prompt'
  | 'designmd'
  | 'tailwind-v4'
  | 'tailwind-v3'
  | 'cssvars'
  | 'shadcn'
  | 'dtcg'
  | 'figma';

export interface GeneratorInfo {
  id: GeneratorId;
  label: string;
  ext: string;
  mime: string;
  run: (scan: DesignScan, opts?: GenerateOptions) => GeneratedFile;
}

/** Registry used by the Generate view; order is the order of the format picker. */
export const GENERATORS: readonly GeneratorInfo[] = [
  {
    id: 'prompt',
    label: 'Prompt',
    ext: 'md',
    mime: 'text/markdown',
    run: (scan, opts) => generatePrompt(scan, { target: opts?.target }),
  },
  { id: 'designmd', label: 'DESIGN.md', ext: 'md', mime: 'text/markdown', run: generateDesignMd },
  {
    id: 'tailwind-v4',
    label: 'Tailwind v4',
    ext: 'css',
    mime: 'text/css',
    run: generateTailwindV4,
  },
  {
    id: 'tailwind-v3',
    label: 'Tailwind v3',
    ext: 'js',
    mime: 'text/javascript',
    run: generateTailwindV3,
  },
  { id: 'cssvars', label: 'CSS vars', ext: 'css', mime: 'text/css', run: generateCssVars },
  { id: 'shadcn', label: 'shadcn', ext: 'css', mime: 'text/css', run: generateShadcn },
  { id: 'dtcg', label: 'DTCG JSON', ext: 'json', mime: 'application/json', run: generateDtcg },
  { id: 'figma', label: 'Figma JSON', ext: 'json', mime: 'application/json', run: generateFigma },
];

export function getGenerator(id: GeneratorId): GeneratorInfo {
  const g = GENERATORS.find((x) => x.id === id);
  if (!g) throw new Error(`unknown generator: ${id}`);
  return g;
}
