// T7.02: Lighthouse report for the website. Run: `pnpm -F @specimen/extension lighthouse [--out <dir>]`.
// Serves site/ locally with the same server as the website e2e tests (pretty URLs + netlify.toml headers, so the
// live CSP counts), runs `lhci collect` 3 times per page with Playwright's Chromium, and prints the median score of
// each category. Never runs against the live site.
//
// Nothing leaves the machine: the site self-hosts its fonts (site/fonts/), so every request goes to the local
// server. If a font fails to load, the report says the scores reflect fallback fonts.
//
// Exit codes: 0 pass, 1 a score is under the bar, 2 Lighthouse did not run. CI (lighthouse.yml) never blocks on it.
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { FONTS_WARNING, type Lhr, RUNS, summarize, toMarkdown, verdict } from './lighthouse-report';
import { parseNetlifyToml } from './netlify';
import { type SiteServer, serveSite } from './server';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const extensionDir = path.resolve(import.meta.dirname, '../..');
const PAGES = ['/', '/privacy/'];
const inCi = process.env.GITHUB_ACTIONS === 'true';

function outDir(): string | undefined {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? path.resolve(process.argv[i + 1] ?? 'lighthouse-report') : undefined;
}

async function run(work: string): Promise<number> {
  const chromePath = chromium.executablePath();
  if (!existsSync(chromePath)) throw new Error(`Chromium not found at ${chromePath}`);
  const config = parseNetlifyToml(readFileSync(path.join(repoRoot, 'netlify.toml'), 'utf8'));
  let server: SiteServer | undefined;
  let lhciCode: number;
  try {
    server = await serveSite(path.join(repoRoot, 'site'), config);
    const rc = path.join(work, 'lighthouserc.json');
    const origin = server.origin;
    writeFileSync(
      rc,
      JSON.stringify({
        ci: {
          collect: {
            url: PAGES.map((p) => origin + p),
            numberOfRuns: RUNS,
            chromePath,
            settings: { chromeFlags: '--headless=new --no-sandbox' },
          },
        },
      }),
    );
    const lhci = path.join(extensionDir, 'node_modules', '.bin', 'lhci');
    // Async spawn, not spawnSync: the server runs in this process and must keep answering Lighthouse.
    lhciCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(lhci, ['collect', `--config=${rc}`], { cwd: work, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', (c) => resolve(c ?? 1));
    });
  } finally {
    await server?.close();
  }

  // A crash part way still reports the runs that finished (missing ones count as failures), then exits 2.
  const lhrDir = path.join(work, '.lighthouseci');
  if (lhciCode !== 0 && !existsSync(lhrDir))
    throw new Error(`lhci collect exited with ${lhciCode}`);
  const files = readdirSync(lhrDir).filter((f) => /^lhr-.*\.json$/.test(f));
  const lhrs = files.map((f) => JSON.parse(readFileSync(path.join(lhrDir, f), 'utf8')) as Lhr);
  const results = summarize(lhrs, PAGES);
  const markdown = toMarkdown(results);
  console.log(`\n${markdown}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);

  const out = outDir();
  if (out) {
    mkdirSync(out, { recursive: true });
    for (const f of readdirSync(lhrDir).filter((n) => /^lhr-.*\.(json|html)$/.test(n))) {
      copyFileSync(path.join(lhrDir, f), path.join(out, f));
    }
    writeFileSync(path.join(out, 'summary.md'), markdown);
  }

  if (results.some((r) => r.fontProblems.length) && inCi)
    console.log(`::warning::T7.02 ${FONTS_WARNING}`);
  if (lhciCode !== 0) {
    console.error(`T7.02 Lighthouse did not finish: lhci collect exited with ${lhciCode}`);
    return 2;
  }
  return verdict(results).length === 0 ? 0 : 1;
}

const work = mkdtempSync(path.join(tmpdir(), 'specimen-lighthouse-'));
let exitCode = 2;
try {
  exitCode = await run(work);
} catch (e) {
  console.error(`T7.02 Lighthouse did not run: ${e instanceof Error ? e.message : e}`);
  console.error(
    'If Chromium is missing: pnpm -F @specimen/extension exec playwright install chromium',
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch (e) {
    console.error(`cleanup failed (ignored): ${e}`);
  }
}
process.exit(exitCode);
