// T7.01 + T7.03: the website in site/ (plain HTML, no build step; Netlify publishes the folder as is).
// "Website builds" (TESTING.md) means here: the folder serves with no errors under the live CSP.
// Nothing leaves the machine: external requests get an empty 200 and external links are only
// compared as href strings.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Browser, type BrowserContext, test as base, expect } from '@playwright/test';
import {
  ctaProblems,
  fontProblems,
  isolate,
  linkProblems,
  openPage,
  overflowProblems,
} from './checks';
import { canonicalUrls, parseNetlifyToml } from './netlify';
import { type SiteServer, serveSite } from './server';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const siteDir = path.join(repoRoot, 'site');
const config = parseNetlifyToml(readFileSync(path.join(repoRoot, 'netlify.toml'), 'utf8'));
const urls = canonicalUrls(config);
const PAGES = ['/', '/privacy/', '/privacy'];
const PHONE = { width: 375, height: 812 };
const LONG_TOKEN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sidepanel.html';

async function createContext(
  browser: Browser,
  origin: string,
  phone = false,
  fonts: 'vendored' | 'blocked' = 'vendored',
) {
  const context = await browser.newContext(phone ? { viewport: PHONE, isMobile: true } : {});
  await isolate(context, origin, fonts);
  return context;
}

// `newContext` through a fixture, so every context is closed even when an assertion throws.
const test = base.extend<{
  newContext: (
    origin: string,
    phone?: boolean,
    fonts?: 'vendored' | 'blocked',
  ) => Promise<BrowserContext>;
}>({
  newContext: async ({ browser }, use) => {
    const made: BrowserContext[] = [];
    await use(async (origin, phone, fonts) => {
      const context = await createContext(browser, origin, phone, fonts);
      made.push(context);
      return context;
    });
    await Promise.all(made.map((c) => c.close()));
  },
});

test.describe('website (site/)', () => {
  let server: SiteServer;
  test.beforeAll(async () => {
    server = await serveSite(siteDir, config);
  });
  test.afterAll(async () => {
    await server?.close();
  });

  test('T7.01 netlify.toml has the CSP and the canonical short links', () => {
    expect(config.headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(urls.install).toMatch(/^https:\/\/chromewebstore\.google\.com\/detail\/[a-p]{32}$/);
    expect(urls.github).toBe('https://github.com/ayu-works/specimen');
  });

  for (const p of PAGES) {
    test(`T7.01 ${p} serves with no errors and every internal link resolves`, async ({
      newContext,
    }) => {
      const context = await newContext(server.origin);
      const { page, problems } = await openPage(context, server.origin + p, server.origin);
      // Netlify answers `/privacy` with a 301 to `/privacy/`, so relative hrefs resolve the same.
      expect(new URL(page.url()).pathname).toBe(p.endsWith('/') ? p : `${p}/`);
      problems.push(...(await fontProblems(page)));
      problems.push(
        ...(await linkProblems(page, context.request, server.origin, config.redirects)),
      );
      expect(problems).toEqual([]);
    });
  }

  for (const p of ['/', '/privacy/']) {
    test(`T7.01 ${p} links Add to Chrome and GitHub at the canonical URLs`, async ({
      newContext,
    }) => {
      const context = await newContext(server.origin);
      const { page } = await openPage(context, server.origin + p, server.origin);
      expect(await ctaProblems(page, server.origin, config.redirects, urls)).toEqual([]);
    });

    test(`T7.03 ${p} has no horizontal scroll at 375px`, async ({ newContext }) => {
      const context = await newContext(server.origin, true);
      const { page, problems } = await openPage(context, server.origin + p, server.origin);
      problems.push(...(await fontProblems(page)));
      expect(problems).toEqual([]);
      expect(await overflowProblems(page, PHONE.width)).toEqual([]);
    });

    // What phone users see while the web fonts load (display=swap) or when they're blocked.
    test(`T7.03 ${p} has no horizontal scroll at 375px with fallback fonts`, async ({
      newContext,
    }) => {
      const context = await newContext(server.origin, true, 'blocked');
      const { page, problems } = await openPage(context, server.origin + p, server.origin);
      expect(problems).toEqual([]);
      // Proves the font check isn't vacuous: with the stylesheet emptied, neither face loads.
      expect(await fontProblems(page)).toEqual([
        'font not loaded: Press Start 2P',
        'font not loaded: VT323',
      ]);
      expect(await overflowProblems(page, PHONE.width)).toEqual([]);
    });
  }
});

// The checks above must fail when the site breaks. Each case edits a temp copy of site/ and asserts
// the specific problem is reported, so a checker that always complains can't pass these.
test.describe('website checks catch breakage', () => {
  let dir: string;
  let server: SiteServer;
  const edit = (file: string, fn: (html: string) => string) => {
    const f = path.join(dir, file);
    writeFileSync(f, fn(readFileSync(f, 'utf8')));
  };
  const once = (html: string, find: string, replace: string) => {
    if (!html.includes(find)) throw new Error(`fixture edit: "${find}" not found`);
    return html.replace(find, replace);
  };

  test.beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'specimen-site-'));
    cpSync(siteDir, dir, { recursive: true });
    edit('index.html', (h) => {
      let out = once(
        h,
        '</body>',
        '<a href="/missing-page/">x</a><a href="#no-such-id">y</a><a href="/privacy/#decoy">z</a></body>',
      );
      // Inside a .scene, whose overflow:hidden would cut it off without any page scroll.
      out = once(
        out,
        '<div class="inner">',
        `<div class="inner"><div id="too-wide-scene" style="width:500px;height:10px"></div><p>${LONG_TOKEN}</p>`,
      );
      return once(out, 'family=VT323', 'family=VT32');
    });
    edit('privacy/index.html', (h) =>
      once(
        h.replaceAll(urls.install, 'https://chromewebstore.google.com/detail/wrong'),
        '</body>',
        '<span data-id="decoy">id="decoy"</span><img alt="" src="https://example.com/x.png"><div id="too-wide" style="width:500px;height:10px"></div><div id="cut-left" style="margin-left:-200px;width:100px;height:10px"></div></body>',
      ),
    );
    server = await serveSite(dir, config);
  });
  test.afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('T7.01 detects a broken internal link and a missing anchor', async ({ newContext }) => {
    const context = await newContext(server.origin);
    const { page } = await openPage(context, `${server.origin}/`, server.origin);
    const problems = await linkProblems(page, context.request, server.origin, config.redirects);
    expect(problems).toEqual([
      '/missing-page/: HTTP 404',
      '#no-such-id: no element with id "no-such-id"',
      '/privacy/#decoy: no element with id "decoy" on /privacy/',
    ]);
  });

  test('T7.01 detects a wrong Add-to-Chrome link', async ({ newContext }) => {
    const context = await newContext(server.origin);
    const { page } = await openPage(context, `${server.origin}/privacy/`, server.origin);
    expect(await ctaProblems(page, server.origin, config.redirects, urls)).toEqual([
      `no Add-to-Chrome link to ${urls.install}`,
    ]);
  });

  test('T7.01 detects an asset the live CSP blocks', async ({ newContext }) => {
    const context = await newContext(server.origin);
    const { problems } = await openPage(context, `${server.origin}/privacy/`, server.origin);
    expect(problems).toContain('CSP violation: img-src https://example.com/x.png');
  });

  test('T7.01 counts a Netlify short link (with or without a trailing slash) as resolving and as the CTA', async ({
    newContext,
  }) => {
    const context = await newContext(server.origin);
    const page = await context.newPage();
    await page.goto(`${server.origin}/privacy/`);
    await page.evaluate(() => {
      document.body.innerHTML = '<a href="/install/">Add</a><a href="/github">Code</a>';
    });
    expect(await linkProblems(page, context.request, server.origin, config.redirects)).toEqual([]);
    expect(await ctaProblems(page, server.origin, config.redirects, urls)).toEqual([]);
  });

  test('T7.03 detects a 500px-wide element and one cut off on the left at 375px', async ({
    newContext,
  }) => {
    const context = await newContext(server.origin, true);
    const { page } = await openPage(context, `${server.origin}/privacy/`, server.origin);
    const problems = await overflowProblems(page, PHONE.width);
    expect(problems).toContainEqual(
      expect.stringMatching(/^div#too-wide spans x \d+\.\.\d+ \(viewport 375\)$/),
    );
    expect(problems).toContainEqual(
      expect.stringMatching(/^div#cut-left spans x -\d+\.\.-?\d+ \(viewport 375\)$/),
    );
  });

  test('T7.01 detects a web font the site no longer requests', async ({ newContext }) => {
    const context = await newContext(server.origin);
    const { page } = await openPage(context, `${server.origin}/`, server.origin);
    expect(await fontProblems(page)).toEqual(['font not loaded: VT323']);
  });

  test('T7.03 detects an element and a long token cut off by a .scene at 375px', async ({
    newContext,
  }) => {
    const context = await newContext(server.origin, true);
    const { page } = await openPage(context, `${server.origin}/`, server.origin);
    const problems = await overflowProblems(page, PHONE.width);
    expect(problems).toContainEqual(
      expect.stringMatching(/^div#too-wide-scene spans x \d+\.\.\d+ \(viewport 375\)$/),
    );
    // A long token in a <p> that itself fits: only the text runs past the edge.
    expect(problems).toContainEqual(
      expect.stringMatching(
        /^text "chrome-extension:\/\/abcdefghijk" in p spans x \d+\.\.\d+ \(viewport 375\)$/,
      ),
    );
  });
});
