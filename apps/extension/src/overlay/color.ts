/** Convert a computed `rgb()/rgba()` string to #rrggbb (null if transparent/unparseable). */
export function toHex(css: string): string | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m?.[1]) return null;
  const p = m[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  const [r, g, b] = p;
  const a = p[3] ?? 1;
  if (r === undefined || g === undefined || b === undefined || a === 0) return null;
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}
