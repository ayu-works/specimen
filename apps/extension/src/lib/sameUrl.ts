/** Same page, ignoring hash, query order and a trailing slash. */
export function sameUrl(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (u: URL) => u.pathname.replace(/\/+$/, '') || '/';
    return x.origin === y.origin && path(x) === path(y) && x.search === y.search;
  } catch {
    return a === b;
  }
}
