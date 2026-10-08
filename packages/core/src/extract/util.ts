import type { RawSample } from '../schema';

/** `"12.5px"` → 12.5; anything else (auto, %, normal, empty) → null. */
export function px(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(-?\d*\.?\d+)px$/.exec(v.trim());
  return m ? Number(m[1]) : null;
}

export const round = (n: number, d = 2): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Add `w` to the bucket `key` of a weight map. */
export function bump<K>(m: Map<K, number>, key: K, w = 1): void {
  m.set(key, (m.get(key) ?? 0) + w);
}

/** Entries of a weight map, heaviest first (stable for equal weights). */
export function ranked<K>(m: Map<K, number>): [K, number][] {
  return [...m].sort((a, b) => b[1] - a[1]);
}

export const area = (s: RawSample): number => s.rect[2] * s.rect[3];

/** First family of a CSS font-family list, unquoted. */
export function primaryFamily(stack: string): string {
  const first = stack.split(',')[0]?.trim() ?? '';
  return first.replace(/^["']|["']$/g, '');
}

export function inside(inner: RawSample['rect'], outer: RawSample['rect'], tol = 2): boolean {
  return (
    inner[0] >= outer[0] - tol &&
    inner[1] >= outer[1] - tol &&
    inner[0] + inner[2] <= outer[0] + outer[2] + tol &&
    inner[1] + inner[3] <= outer[1] + outer[3] + tol
  );
}
