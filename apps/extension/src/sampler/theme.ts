/**
 * Class/attribute theme switching (ARCHITECTURE §5): temporarily put the page in the other color
 * scheme by toggling the `class` / `data-*` switch it already declares, then restore.
 */

export interface ThemeTokens {
  dark: string[];
  light: string[];
}

export interface AppliedTheme {
  /** True when something about the document actually changed. */
  changed: boolean;
  restore: () => void;
}

type Switch = { kind: 'class'; name: string } | { kind: 'attr'; name: string; value: string };

function parse(token: string): Switch | null {
  if (token.startsWith('class:')) return { kind: 'class', name: token.slice(6) };
  const m = /^attr:([^=]+)=(.+)$/.exec(token);
  return m ? { kind: 'attr', name: m[1] as string, value: m[2] as string } : null;
}

/** Put `<html>` in `scheme`: add that scheme's switches, remove the other scheme's. */
export function applyTheme(scheme: 'dark' | 'light', tokens: ThemeTokens): AppliedTheme {
  const html = document.documentElement;
  const body = document.body;
  const want = (scheme === 'dark' ? tokens.dark : tokens.light).flatMap((t) => parse(t) ?? []);
  const drop = (scheme === 'dark' ? tokens.light : tokens.dark).flatMap((t) => parse(t) ?? []);
  const els = [html, body];
  const snapshot = els.map((el) => ({
    el,
    cls: el.getAttribute('class'),
    attrs: new Map<string, string | null>(),
  }));
  const remember = (el: Element, name: string) => {
    const snap = snapshot.find((s) => s.el === el);
    if (snap && !snap.attrs.has(name)) snap.attrs.set(name, el.getAttribute(name));
  };

  for (const sw of drop) {
    for (const el of els) {
      if (sw.kind === 'class' && el.classList.contains(sw.name)) el.classList.remove(sw.name);
      else if (sw.kind === 'attr' && el.getAttribute(sw.name) === sw.value) {
        remember(el, sw.name);
        el.removeAttribute(sw.name);
      }
    }
  }
  for (const sw of want) {
    if (sw.kind === 'class') html.classList.add(sw.name);
    else {
      remember(html, sw.name);
      html.setAttribute(sw.name, sw.value);
    }
  }

  // Freeze transitions so colors are read at their final value.
  const freeze = document.createElement('style');
  freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
  document.head.append(freeze);

  const changed = snapshot.some(
    (s) =>
      s.el.getAttribute('class') !== s.cls ||
      [...s.attrs].some(([name, old]) => s.el.getAttribute(name) !== old),
  );
  return {
    changed,
    restore: () => {
      freeze.remove();
      for (const s of snapshot) {
        if (s.cls === null) s.el.removeAttribute('class');
        else s.el.setAttribute('class', s.cls);
        for (const [name, old] of s.attrs) {
          if (old === null) s.el.removeAttribute(name);
          else s.el.setAttribute(name, old);
        }
      }
    },
  };
}

/** Wait for the style recalculation (and any scheduled repaint) after a theme change. */
export function settle(ms = 120): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, ms)));
  });
}
