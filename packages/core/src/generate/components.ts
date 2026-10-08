import type { ComponentSpec, DesignScan } from '../schema';
import { px, radiusText } from './common';

export type ComponentKind = ComponentSpec['kind'];

export const COMPONENT_LABELS: Record<ComponentKind, string> = {
  'button-primary': 'Primary button',
  'button-secondary': 'Secondary button',
  'button-ghost': 'Ghost button',
  input: 'Input',
  card: 'Card',
  'nav-link': 'Nav link',
  badge: 'Badge',
};

const PROP_LABELS: Record<string, string> = {
  'background-color': 'background',
  color: 'text',
  'border-color': 'border color',
  'border-width': 'border width',
  'border-radius': 'radius',
  padding: 'padding',
  'font-size': 'font size',
  'font-weight': 'weight',
  'box-shadow': 'shadow',
  height: 'height',
  outline: 'outline',
  'outline-color': 'outline color',
  'outline-offset': 'outline offset',
  transform: 'transform',
  opacity: 'opacity',
  'text-decoration': 'text decoration',
  'text-decoration-color': 'underline color',
  filter: 'filter',
  border: 'border',
};

export function propLabel(prop: string): string {
  return PROP_LABELS[prop] ?? prop;
}

/** `background #4a32e0, text #fff` for a (state) property map. */
export function describeProps(props: Record<string, string>): string {
  return Object.entries(props)
    .map(([k, v]) => `${propLabel(k)} ${k === 'box-shadow' ? `\`${v}\`` : v}`)
    .join(', ');
}

function radiusOf(v: string): string {
  const m = /^(-?\d*\.?\d+)px$/.exec(v.trim());
  return m ? radiusText(Number(m[1])) : v;
}

/** One-line description of a component's measured base styles. */
export function describeBase(base: Record<string, string>): string {
  const parts: string[] = [];
  const bg = base['background-color'];
  if (bg) parts.push(bg === 'transparent' ? 'transparent background' : `background ${bg}`);
  if (base.color) parts.push(`text ${base.color}`);
  const bw = base['border-width'];
  if (bw && bw !== '0px') {
    parts.push(`${bw} border${base['border-color'] ? ` in ${base['border-color']}` : ''}`);
  } else if (bw) parts.push('no border');
  if (base['border-radius']) parts.push(`radius ${radiusOf(base['border-radius'])}`);
  if (base.padding) parts.push(`padding ${base.padding}`);
  if (base['font-size']) {
    parts.push(
      `${base['font-size']}${base['font-weight'] ? ` / weight ${base['font-weight']}` : ''}`,
    );
  }
  if (base['box-shadow'] && base['box-shadow'] !== 'none')
    parts.push(`shadow \`${base['box-shadow']}\``);
  else if (base['box-shadow']) parts.push('no shadow');
  if (base.height) parts.push(`height ${px(Number.parseFloat(base.height))}`);
  return parts.join(', ');
}

/** Markdown bullets for one measured component: base line plus one sub-bullet per state. */
export function measuredLines(spec: ComponentSpec, lead = '-'): string[] {
  const label = COMPONENT_LABELS[spec.kind];
  const out = [`${lead} ${label}: ${describeBase(spec.base)}.`];
  for (const [state, props] of Object.entries(spec.states)) {
    if (!props || Object.keys(props).length === 0) continue;
    out.push(`  - ${label} ${state}: ${describeProps(props)}`);
  }
  return out;
}

export function measured(scan: DesignScan, kind: ComponentKind): ComponentSpec | undefined {
  return scan.components?.find((c) => c.kind === kind && Object.keys(c.base).length > 0);
}
