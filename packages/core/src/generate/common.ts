import { toHex, toOklch } from '../color';
import {
  type ColorRole,
  ColorRoleSchema,
  type ColorToken,
  type DesignScan,
  type TypeStyle,
} from '../schema';

/** What every generator returns. Pure data: the caller decides what to do with it. */
export interface GeneratedFile {
  filename: string;
  mime: string;
  content: string;
}

export const ROLE_ORDER: readonly ColorRole[] = ColorRoleSchema.options;

export const TYPE_ORDER: readonly TypeStyle['role'][] = [
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
];

/** Fixed one-line usage note per color role. */
export const ROLE_USAGE: Record<ColorRole, string> = {
  background: 'page background',
  surface: 'cards, panels, navigation',
  surfaceAlt: 'alternate bands, hover fills, code blocks',
  textPrimary: 'headings and body text',
  textSecondary: 'supporting text, descriptions',
  textMuted: 'captions, placeholders, disabled text',
  border: 'dividers, card and input outlines',
  accent: 'primary buttons, links, key highlights',
  accentHover: 'hover state of accent elements',
  accentForeground: 'text and icons placed on accent backgrounds',
  link: 'inline text links',
  success: 'positive status',
  warning: 'cautionary status',
  danger: 'errors and destructive actions',
};

export function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function fmt(n: number, digits = 2): string {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return String(Object.is(r, -0) ? 0 : r);
}

export const px = (n: number): string => `${fmt(n)}px`;
export const rem = (n: number): string => `${fmt(n / 16, 4)}rem`;

export interface RoleColor {
  role: ColorRole;
  token: ColorToken;
}

type Colors = DesignScan['colors'];

/** Roles that are present, in canonical order. */
export function roleColors(scan: DesignScan, colors: Partial<Colors> = scan.colors): RoleColor[] {
  const palette = colors.palette ?? scan.colors.palette;
  const roles = colors.roles ?? {};
  const out: RoleColor[] = [];
  for (const role of ROLE_ORDER) {
    const id = roles[role];
    const token = id ? palette.find((t) => t.id === id) : undefined;
    if (token) out.push({ role, token });
  }
  return out;
}

/** The captured/derived opposite-scheme colors, if the scan carries any. */
export function themeVariant(
  scan: DesignScan,
): { scheme: 'dark' | 'light'; colors: Partial<Colors> } | undefined {
  const v = scan.variants;
  if (v?.dark?.roles) return { scheme: 'dark', colors: v.dark };
  if (v?.light?.roles) return { scheme: 'light', colors: v.light };
  return undefined;
}

export function roleHex(scan: DesignScan, role: ColorRole): string | undefined {
  const id = scan.colors.roles[role];
  return id ? scan.colors.palette.find((t) => t.id === id)?.hex : undefined;
}

export function firstHex(scan: DesignScan, ...roles: ColorRole[]): string | undefined {
  for (const r of roles) {
    const h = roleHex(scan, r);
    if (h) return h;
  }
  return undefined;
}

/** Palette tokens that no role uses, heaviest first (stable). */
export function extraPalette(scan: DesignScan, limit = Number.POSITIVE_INFINITY): ColorToken[] {
  const used = new Set(Object.values(scan.colors.roles));
  return scan.colors.palette
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !used.has(t.id))
    .sort((a, b) => b.t.weight - a.t.weight || a.i - b.i)
    .slice(0, limit)
    .map(({ t }) => t);
}

export function oklchCss(l: number, c: number, h: number, alpha = 1): string {
  const a = alpha < 1 ? ` / ${fmt(alpha, 3)}` : '';
  return `oklch(${fmt(l, 3)} ${fmt(c, 3)} ${fmt(c < 0.0005 ? 0 : h, 2)}${a})`;
}

export function hexToOklch(hex: string): string {
  const [l, c, h] = toOklch(hex);
  const alpha = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
  return oklchCss(l, c, h, alpha);
}

export function orderedStyles(scan: DesignScan): TypeStyle[] {
  return [...scan.typography.styles].sort(
    (a, b) => TYPE_ORDER.indexOf(a.role) - TYPE_ORDER.indexOf(b.role),
  );
}

export type Family = DesignScan['typography']['families'][number];

export function familyOf(scan: DesignScan, id: string): Family | undefined {
  return scan.typography.families.find((f) => f.id === id);
}

/** Display / body / mono families with sensible fallbacks. */
export function familyByRole(scan: DesignScan, role: Family['role']): Family | undefined {
  const fams = scan.typography.families;
  const direct = fams.find((f) => f.role === role);
  if (direct) return direct;
  if (role === 'mono') return undefined;
  if (role === 'display') {
    const h = scan.typography.styles.find((s) => s.role === 'display' || s.role === 'h1');
    return (h && familyOf(scan, h.familyId)) || fams.find((f) => f.role === 'body') || fams[0];
  }
  return fams.find((f) => f.role !== 'mono') ?? fams[0];
}

/** One shadow per level (the heaviest), ascending by level. */
export function levelShadows(scan: DesignScan): { level: 1 | 2 | 3; css: string }[] {
  const out: { level: 1 | 2 | 3; css: string }[] = [];
  for (const level of [1, 2, 3] as const) {
    const best = scan.shadows
      .filter((s) => s.level === level)
      .sort((a, b) => b.weight - a.weight)[0];
    if (best) out.push({ level, css: best.css });
  }
  return out;
}

export const cssRadius = (v: number): string => (v >= 9999 ? '9999px' : px(v));

export function radiusText(v: number): string {
  return v >= 9999 ? 'pill (fully rounded)' : px(v);
}

/** The main interactive radius: button, else card, else the most-used one. */
export function primaryRadius(scan: DesignScan): number {
  return (
    (scan.radii.pillButtons ? 9999 : undefined) ??
    scan.radii.button ??
    scan.radii.card ??
    scan.radii.scale[0]?.value ??
    0
  );
}

/** Ascending breakpoints, dropping values within 16px of the previous one; max 5. */
export function breakpoints(scan: DesignScan): { name: string; px: number }[] {
  const names = ['sm', 'md', 'lg', 'xl', '2xl'];
  const kept: number[] = [];
  for (const b of [...scan.layout.breakpoints].sort((a, c) => a - c)) {
    const prev = kept[kept.length - 1];
    if (prev === undefined || b - prev > 16) kept.push(b);
  }
  return kept.slice(0, 5).map((v, i) => ({ name: names[i] ?? `bp${i}`, px: v }));
}

/** Nearest value on the spacing scale (falls back to the raw target). */
export function nearestSpace(scan: DesignScan, target: number): number {
  const scale = scan.spacing.scale;
  if (scale.length === 0) return target;
  let best = scale[0] ?? target;
  for (const v of scale) if (Math.abs(v - target) < Math.abs(best - target)) best = v;
  return best;
}

export interface ShadowLayer {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const COLOR_RE = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|#[0-9a-f]{3,8})/i;

/** Parse a CSS box-shadow into layers; null when it can't be understood. */
export function parseShadow(css: string): ShadowLayer[] | null {
  const layers: ShadowLayer[] = [];
  for (const part of splitTop(css)) {
    const colorMatch = COLOR_RE.exec(part);
    const rest = part.replace(COLOR_RE, ' ');
    const nums = [...rest.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
    if (nums.length < 2 || nums.length > 4) return null;
    let color = '#000000';
    if (colorMatch?.[1]) {
      try {
        color = toHex(colorMatch[1]);
      } catch {
        return null;
      }
    }
    layers.push({
      inset: /\binset\b/i.test(part),
      x: nums[0] ?? 0,
      y: nums[1] ?? 0,
      blur: nums[2] ?? 0,
      spread: nums[3] ?? 0,
      color,
    });
  }
  return layers.length > 0 ? layers : null;
}

export function jsonOut(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** Escape a value for a Markdown table cell. */
export function cell(s: string | number): string {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function table(head: string[], rows: (string | number)[][]): string {
  const line = (cols: (string | number)[]) => `| ${cols.map(cell).join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}
