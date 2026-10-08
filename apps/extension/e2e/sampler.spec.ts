import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { type Page, test as pwTest } from '@playwright/test';
import { RawPageSchema } from '@specimen/core/schema';
import { startFixtureServer } from '../../../fixtures/serve';
import { expect, test as extTest } from './fixtures';

const appRoot = path.resolve(import.meta.dirname, '..');
const SAMPLER = path.join(appRoot, '.output/sampler.iife.js');
const PAGES = path.resolve(import.meta.dirname, '../../../fixtures/pages');

pwTest.beforeAll(() => {
  execFileSync('node', ['scripts/build-sampler.mjs'], { cwd: appRoot, stdio: 'pipe' });
});

type Sample = import('@specimen/core/schema').RawPage;

async function sample(page: Page, url: string, opts: { validate?: boolean } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.addScriptTag({ path: SAMPLER });
  return page.evaluate(async (validate) => {
    const t0 = performance.now();
    // biome-ignore lint/suspicious/noExplicitAny: injected global
    const raw = await (globalThis as any).__specimenSample(validate ? {} : { validate: () => {} });
    return { raw, ms: performance.now() - t0 };
  }, opts.validate ?? false) as Promise<{ raw: Sample; ms: number }>;
}

/** A throwaway server for the cross-origin stylesheet tests. */
function listen(handler: (url: string) => { type: string; body: string }): Promise<{
  origin: string;
  host: string;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    const out = handler(req.url ?? '/');
    res.writeHead(200, { 'content-type': out.type });
    res.end(out.body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        host: `127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
            server.closeAllConnections();
          }),
      });
    });
  });
}

const XO_CSS = `:root { --xo-color: #123456; --xo-gap: 12px }
@media (min-width: 999px) { .xo { color: red } }
@font-face { font-family: "XO Font"; src: url(xo.woff2) format("woff2"); font-weight: 600 }`;

pwTest.describe('sampler (plain Chromium)', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>;
  pwTest.beforeAll(async () => {
    server = await startFixtureServer();
  });
  pwTest.afterAll(async () => {
    await server.close();
  });

  pwTest(
    'T1.07 ≤4000 samples, hidden nodes excluded, <300ms on landing-basic',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${server.url}/landing-basic.html`);
      // Inject hidden/skipped content, then compare against the clean baseline.
      await page.addScriptTag({ path: SAMPLER });
      const run = () =>
        page.evaluate(async () => {
          const t0 = performance.now();
          // biome-ignore lint/suspicious/noExplicitAny: injected global
          const raw = await (globalThis as any).__specimenSample({ validate: () => {} });
          return { raw, ms: performance.now() - t0 };
        }) as Promise<{ raw: Sample; ms: number }>;
      await run(); // warm-up (style/layout caches)
      const base = await run();
      await page.evaluate(() => {
        const wrap = document.createElement('div');
        wrap.innerHTML = `
        <h2 style="display:none">HIDDEN-MARKER-DISPLAY</h2>
        <h2 style="visibility:hidden">HIDDEN-MARKER-VISIBILITY</h2>
        <h2 style="opacity:0">HIDDEN-MARKER-OPACITY</h2>
        <h2 style="width:0;height:0;overflow:hidden">HIDDEN-MARKER-ZERO</h2>
        <div style="display:none"><h2>HIDDEN-MARKER-CHILD</h2><p>x</p></div>
        <script>/* HIDDEN-MARKER-SCRIPT */</script><style>.x{}</style><noscript>n</noscript>
        <template><h2>HIDDEN-MARKER-TEMPLATE</h2></template>`;
        document.body.appendChild(wrap);
        document
          .querySelector('.logo-item svg')
          ?.insertAdjacentHTML('beforeend', '<g><path d="M0 0h10v10z"/></g>');
      });
      const withHidden = await run();
      const { raw, ms } = base;
      expect(raw.samples.length).toBeGreaterThan(50);
      expect(raw.samples.length).toBeLessThanOrEqual(4000);
      // Hidden/skipped content adds no samples (the wrapper div itself is zero-height only if empty).
      expect(JSON.stringify(withHidden.raw.samples)).not.toContain('HIDDEN-MARKER');
      const tags = new Set(withHidden.raw.samples.map((s) => s.tag));
      for (const t of ['script', 'style', 'noscript', 'template', 'path', 'g', 'circle', 'rect']) {
        expect(tags.has(t), `tag ${t} must not be sampled`).toBe(false);
      }
      expect(tags.has('svg')).toBe(true);
      expect(withHidden.raw.samples.length).toBeLessThanOrEqual(raw.samples.length + 1);
      expect(ms, `sampling took ${ms.toFixed(1)}ms`).toBeLessThan(300);
      // The sample set must be JSON-safe and valid.
      expect(() => RawPageSchema.parse(JSON.parse(JSON.stringify(raw)))).not.toThrow();
      // Snippets only on headings, buttons, links; ≤ 60 chars.
      for (const s of raw.samples) {
        if (s.text?.snippet !== undefined) {
          expect(s.text.snippet.length).toBeLessThanOrEqual(60);
          expect(
            s.heading !== undefined || s.interactive === 'button' || s.interactive === 'link',
          ).toBe(true);
        }
      }
      const h1 = raw.samples.find((s) => s.heading === 1);
      expect(h1?.text?.snippet).toContain('Product analytics');
      expect(raw.samples.some((s) => s.interactive === 'button' && s.tag === 'a')).toBe(true);
      console.log(`landing-basic: ${raw.samples.length} samples, ${ms.toFixed(1)}ms`);
    },
  );

  pwTest('T1.07 caps at 4000 samples on a huge DOM', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${server.url}/landing-basic.html`);
    await page.evaluate(() => {
      const root = document.createElement('main');
      for (let i = 0; i < 6000; i++) {
        const d = document.createElement('div');
        d.textContent = `row ${i}`;
        d.style.height = '10px';
        root.appendChild(d);
      }
      document.body.appendChild(root);
    });
    await page.addScriptTag({ path: SAMPLER });
    const raw = (await page.evaluate(async () => {
      // biome-ignore lint/suspicious/noExplicitAny: injected global
      return (globalThis as any).__specimenSample({ validate: () => {} });
    })) as Sample;
    expect(raw.samples.length).toBe(4000);
    expect(raw.warnings.some((w) => w.startsWith('sample cap reached'))).toBe(true);
    expect(raw.samples.every((s, i) => s.i === i)).toBe(true);
  });

  pwTest('T1.08 root custom properties captured (--brand #5e6ad2)', async ({ page }) => {
    const { raw } = await sample(page, `${server.url}/landing-basic.html`, { validate: true });
    expect(raw.rootVars['--brand']).toBe('#5e6ad2');
    expect(raw.rootVars['--space-12']).toBe('96px');
    expect(raw.rootVars['--font']).toContain('system-ui');
  });

  pwTest('T1.09 @media breakpoints 640/768/1024/1280 captured', async ({ page }) => {
    const { raw } = await sample(page, `${server.url}/landing-basic.html`);
    for (const bp of [640, 768, 1024, 1280]) {
      expect(raw.mediaQueries).toContain(`(min-width: ${bp}px)`);
    }
  });

  pwTest('T1.10 landing-basic yields 8 top-level sections', async ({ page }) => {
    const { raw } = await sample(page, `${server.url}/landing-basic.html`);
    expect(raw.sections).toHaveLength(8);
    const ys = raw.sections.map((s) => s.rect[1]);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(raw.sections[0]?.landmark).toBe('header');
    expect(raw.sections.at(-1)?.landmark).toBe('footer');
    // Every sample is attributed to a section or -1 (wrappers above the sections).
    expect(raw.samples.some((s) => s.section >= 0)).toBe(true);
  });

  pwTest(
    'T1.12 cross-origin stylesheet without permission → warning, scan succeeds',
    async ({ page }) => {
      // Page on 127.0.0.1, stylesheet on `localhost`: a different origin, so its rules are unreadable.
      const css = await listen(() => ({ type: 'text/css', body: XO_CSS }));
      const host = await listen(() => ({
        type: 'text/html',
        body: `<!doctype html><html><head><title>xo</title><link rel="stylesheet" href="${css.origin.replace('127.0.0.1', 'localhost')}/xo.css"></head><body><h1>Hello</h1></body></html>`,
      }));
      try {
        const expectedWarning = `cross-origin stylesheet skipped: localhost:${css.host.split(':')[1]}`;
        // (1) no fetcher at all, (2) a fetcher that was denied (background returns null per URL).
        for (const denied of [false, true]) {
          await page.goto(`${host.origin}/`);
          await page.addScriptTag({ path: SAMPLER });
          const raw = (await page.evaluate(async (d) => {
            // biome-ignore lint/suspicious/noExplicitAny: injected global
            const g = globalThis as any;
            return g.__specimenSample(
              d ? { fetchCss: async (u: string[]) => u.map(() => null) } : {},
            );
          }, denied)) as Sample;
          expect(() => RawPageSchema.parse(raw)).not.toThrow();
          expect(raw.warnings).toContain(expectedWarning);
          expect(raw.rootVars['--xo-color']).toBeUndefined();
          expect(raw.samples.length).toBeGreaterThan(0);
        }
      } finally {
        await host.close();
        await css.close();
      }
    },
  );

  pwTest(
    'T1.12 cross-origin.html fixture: skipped-stylesheet warning, scan still succeeds',
    async ({ page }) => {
      // The fixture links http://localhost:4999/xo.css; the page itself is on 127.0.0.1 (another origin).
      await page.route('http://localhost:4999/xo.css', (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: XO_CSS }),
      );
      const { raw } = await sample(page, `${server.url}/cross-origin.html`, { validate: true });
      expect(raw.warnings).toContain('cross-origin stylesheet skipped: localhost:4999');
      expect(raw.rootVars['--xo-color']).toBeUndefined();
      expect(raw.rootVars['--local']).toBe('#0d9488'); // same-origin <style> still parsed
      expect(raw.samples.length).toBeGreaterThan(0);
    },
  );

  pwTest('section counts match every fixture’s expected sectionKinds', async ({ page }) => {
    const counts: Record<string, string> = {};
    for (const f of readdirSync(PAGES).filter((n) => n.endsWith('.html'))) {
      const name = f.replace('.html', '');
      if (!existsSync(path.join(PAGES, `${name}.expected.json`))) continue; // e.g. cross-origin.html
      const expected = JSON.parse(readFileSync(path.join(PAGES, `${name}.expected.json`), 'utf8'));
      const { raw, ms } = await sample(page, `${server.url}/${f}`, { validate: true });
      counts[name] =
        `${raw.sections.length}/${expected.layout.sectionKinds.length} (${raw.samples.length} samples, ${ms.toFixed(0)}ms)`;
      expect(raw.sections.length, name).toBe(expected.layout.sectionKinds.length);
    }
    console.log('fixture section counts', counts);
  });
});

extTest.describe('full extension', () => {
  let fixtures: Awaited<ReturnType<typeof startFixtureServer>>;
  extTest.beforeAll(async () => {
    fixtures = await startFixtureServer();
  });
  extTest.afterAll(async () => {
    await fixtures.close();
  });

  async function scan(
    context: import('@playwright/test').BrowserContext,
    extensionId: string,
    url: string,
  ) {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const target = await context.newPage();
    await target.goto(url);
    await target.bringToFront();
    const result = await panel.evaluate(async (u) => {
      const [tab] = await chrome.tabs.query({ url: u });
      if (!tab?.id) throw new Error(`no tab for ${u}`);
      return chrome.runtime.sendMessage({ type: 'scan.run', tabId: tab.id });
    }, url);
    return { result, panel, target };
  }

  extTest(
    'T1.11 scan.run returns a valid RawPage and a JPEG screenshot',
    async ({ context, extensionId }) => {
      const { result } = await scan(context, extensionId, `${fixtures.url}/landing-basic.html`);
      expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(true);
      const { raw, screenshot } = result.data;
      expect(() => RawPageSchema.parse(raw)).not.toThrow();
      expect(raw.url).toBe(`${fixtures.url}/landing-basic.html`);
      expect(raw.sections).toHaveLength(8);
      expect(raw.rootVars['--brand']).toBe('#5e6ad2');
      expect(screenshot).toMatch(/^data:image\/jpeg;base64,/);
      // 640px wide JPEG: parse the SOF marker for the dimensions.
      const bytes = Buffer.from(screenshot.split(',')[1], 'base64');
      expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
      let w = 0;
      for (let i = 2; i < bytes.length - 9; ) {
        if (bytes[i] !== 0xff) break;
        const marker = bytes[i + 1] as number;
        if (marker >= 0xc0 && marker <= 0xc3) {
          w = (bytes[i + 7] as number) * 256 + (bytes[i + 8] as number);
          break;
        }
        i += 2 + (bytes[i + 2] as number) * 256 + (bytes[i + 3] as number);
      }
      expect(w).toBe(640);
    },
  );

  extTest(
    'Scan button in the side panel shows counts and thumbnail',
    async ({ context, extensionId }) => {
      const target = await context.newPage();
      await target.goto(`${fixtures.url}/landing-basic.html`);
      const panel = await context.newPage();
      // The panel's "active tab" is itself; scan via the active-tab path by fronting the target
      // and invoking the button handler through a tab query override.
      await panel.addInitScript((url) => {
        const orig = chrome.tabs.query.bind(chrome.tabs);
        // biome-ignore lint/suspicious/noExplicitAny: test shim
        (chrome.tabs as any).query = async () => orig({ url });
      }, `${fixtures.url}/landing-basic.html`);
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await target.bringToFront();
      await panel
        .getByRole('button', { name: 'Scan', exact: true })
        .evaluate((b) => (b as HTMLElement).click());
      await expect(panel.getByTestId('section-count')).toHaveText('8');
      await expect(panel.getByAltText('Page thumbnail')).toBeVisible();
    },
  );

  extTest(
    'cross-origin stylesheet with host permission is fetched and parsed',
    async ({ context, extensionId }) => {
      const css = await listen(() => ({ type: 'text/css', body: XO_CSS }));
      const page = await listen(() => ({
        type: 'text/html',
        body: `<!doctype html><html><head><title>xo</title><link rel="stylesheet" href="${css.origin}/xo.css"></head><body><h1>Hello</h1></body></html>`,
      }));
      try {
        const { result } = await scan(context, extensionId, `${page.origin}/`);
        expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(true);
        const { raw } = result.data;
        expect(raw.warnings).toEqual([]);
        expect(raw.rootVars['--xo-color']).toBe('#123456');
        expect(raw.mediaQueries).toContain('(min-width: 999px)');
        expect(raw.fontFaces.some((f: { family: string }) => f.family === 'XO Font')).toBe(true);
      } finally {
        await page.close();
        await css.close();
      }
    },
  );
});
