// Checks for the website tests. Each returns a list of human-readable problems (empty = pass), so a
// failing test names the broken href, the CSP violation or the overflowing element.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import type { Redirect } from './netlify';

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

const FONTS_DIR = path.join(import.meta.dirname, 'fonts');
/** The site's web fonts, served from local copies (see fonts/README.md). */
const FONTS: [family: string, file: string][] = [
  ['Press Start 2P', 'pressstart2p-latin.woff2'],
  ['VT323', 'vt323-latin.woff2'],
];
const FONT_CSS = FONTS.map(
  ([family, file]) =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.gstatic.com/specimen-test/${file}) format('woff2')}`,
).join('\n');

/**
 * Keeps every request on the machine. Google Fonts get the vendored copies (or, with
 * `fonts: 'blocked'`, an empty stylesheet: what users see while fonts load or when they're blocked);
 * anything else not on `origin` gets an empty 200. CSP still applies first, so a host the policy
 * forbids is reported, not fulfilled.
 */
export async function isolate(
  context: BrowserContext,
  origin: string,
  fonts: 'vendored' | 'blocked' = 'vendored',
): Promise<void> {
  await context.route(
    (url) => url.origin !== origin,
    async (route) => {
      const url = new URL(route.request().url());
      if (fonts === 'vendored' && url.hostname === 'fonts.googleapis.com') {
        return route.fulfill({ status: 200, contentType: 'text/css', body: FONT_CSS });
      }
      const font = FONTS.find(([, file]) => url.pathname === `/specimen-test/${file}`);
      if (fonts === 'vendored' && url.hostname === 'fonts.gstatic.com' && font) {
        const body = await readFile(path.join(FONTS_DIR, font[1]));
        return route.fulfill({ status: 200, contentType: 'font/woff2', body });
      }
      const css = route.request().resourceType() === 'stylesheet';
      return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/plain', body: '' });
    },
  );
  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations?.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}

/**
 * Both web fonts loaded. `fonts.check` alone is true when no face matches at all (an empty
 * stylesheet), so a loaded face per family is required too.
 */
export async function fontProblems(page: Page): Promise<string[]> {
  const families = FONTS.map(([family]) => family);
  return page.evaluate(async (families) => {
    await document.fonts.ready;
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded');
    return families
      .filter(
        (fam) =>
          !document.fonts.check(`16px "${fam}"`) ||
          !loaded.some((f) => f.family.replace(/["']/g, '') === fam),
      )
      .map((fam) => `font not loaded: ${fam}`);
  }, families);
}

/** Opens `url` and reports load errors: bad status, page errors, console errors, CSP violations. */
export async function openPage(
  context: BrowserContext,
  url: string,
  origin: string,
): Promise<{ page: Page; problems: string[] }> {
  const problems: string[] = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (new URL(r.url()).origin === origin && r.status() >= 400) {
      problems.push(`HTTP ${r.status()} for ${r.url()}`);
    }
  });
  const res = await page.goto(url, { waitUntil: 'load' });
  if (res?.status() !== 200) problems.push(`HTTP ${res?.status()} for page ${url}`);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const csp = await page.evaluate(() => window.__cspViolations ?? []);
  for (const v of csp) problems.push(`CSP violation: ${v}`);
  return { page, problems };
}

const LINK_SELECTORS: [string, string][] = [
  ['a[href]', 'href'],
  ['link[href]', 'href'],
  ['script[src]', 'src'],
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['iframe[src]', 'src'],
];

/** Every same-origin link and asset on the page resolves; every `#fragment` has a target id. */
export async function linkProblems(
  page: Page,
  request: APIRequestContext,
  origin: string,
  redirects: Redirect[],
): Promise<string[]> {
  const raw = await page.evaluate((selectors) => {
    const out: string[] = [];
    for (const [sel, attr] of selectors) {
      for (const el of document.querySelectorAll(sel)) out.push(el.getAttribute(attr) ?? '');
    }
    for (const el of document.querySelectorAll('img[srcset], source[srcset]')) {
      for (const part of (el.getAttribute('srcset') ?? '').split(',')) {
        out.push(part.trim().split(/\s+/)[0] ?? '');
      }
    }
    return out;
  }, LINK_SELECTORS);

  const problems: string[] = [];
  const here = new URL(page.url());
  const pages = new Map<string, Promise<{ status: number; body: string }>>();
  const fetchPage = (u: string) => {
    let p = pages.get(u);
    if (!p) {
      p = request
        .get(u, { maxRedirects: 0 })
        .then(async (r) => ({ status: r.status(), body: await r.text() }));
      pages.set(u, p);
    }
    return p;
  };

  for (const href of new Set(raw)) {
    const url = new URL(href, here);
    if (url.origin !== origin) continue; // external: asserted on as hrefs elsewhere, never fetched
    if (redirects.some((r) => r.from === url.pathname)) continue; // a Netlify short link
    const fragment = decodeURIComponent(url.hash.slice(1));
    url.hash = '';
    const samePage = url.pathname === here.pathname && url.search === here.search;
    if (samePage && fragment) {
      const found = await page.evaluate((id) => document.getElementById(id) !== null, fragment);
      if (!found) problems.push(`${href}: no element with id "${fragment}"`);
      continue;
    }
    const { status, body } = await fetchPage(url.href);
    if (status !== 200) {
      problems.push(`${href}: HTTP ${status}`);
      continue;
    }
    if (fragment && !body.includes(`id="${fragment}"`)) {
      problems.push(`${href}: no element with id "${fragment}" on ${url.pathname}`);
    }
  }
  return problems;
}

/** The page links the Chrome Web Store listing and the GitHub repo at the canonical URLs. */
export async function ctaProblems(
  page: Page,
  origin: string,
  redirects: Redirect[],
  urls: { install: string; github: string },
): Promise<string[]> {
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href),
  );
  const targets = new Set(
    hrefs.map((h) => {
      const u = new URL(h);
      const short = u.origin === origin && redirects.find((r) => r.from === u.pathname);
      return short ? short.to : h;
    }),
  );
  const problems: string[] = [];
  if (!targets.has(urls.install)) problems.push(`no Add-to-Chrome link to ${urls.install}`);
  if (!targets.has(urls.github)) problems.push(`no GitHub link to ${urls.github}`);
  return problems;
}

/**
 * The page can't scroll sideways and nothing sticks out of the viewport. The per-element check
 * looks through `overflow-x:hidden` on html/body, which would hide a too-wide element from the
 * scroll checks while still cutting it off; an element inside any other clipping ancestor (an
 * inner scroller) is that ancestor's business and is skipped.
 */
export async function overflowProblems(page: Page, width: number): Promise<string[]> {
  await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  });
  // Compare with the device width, not innerWidth: mobile Chrome widens the layout viewport (zooms
  // out) to fit content that's too wide, which would make innerWidth grow with the bug.
  return page.evaluate((vw) => {
    const problems: string[] = [];
    if (window.innerWidth > vw) problems.push(`layout viewport ${window.innerWidth} > ${vw}`);
    const doc = document.documentElement;
    if (doc.scrollWidth > vw) problems.push(`html scrollWidth ${doc.scrollWidth} > ${vw}`);
    if (document.body.scrollWidth > vw) {
      problems.push(`body scrollWidth ${document.body.scrollWidth} > ${vw}`);
    }
    window.scrollTo(500, window.scrollY);
    if (window.scrollX !== 0) problems.push(`page scrolls sideways (scrollX ${window.scrollX})`);
    window.scrollTo(0, window.scrollY);

    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const cls =
        typeof el.className === 'string' && el.className
          ? `.${el.className.trim().split(/\s+/).join('.')}`
          : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    const clipped = (el: Element) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue; // inside, or cut off on neither side
      if (clipped(el)) continue;
      problems.push(
        `${describe(el)} spans x ${Math.round(r.left)}..${Math.round(r.right)} (viewport ${vw})`,
      );
    }
    return problems;
  }, width);
}
