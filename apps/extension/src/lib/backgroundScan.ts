/** The background worker's scan work: sampling, the thumbnail, cross-origin CSS and the offscreen document. */
import type { ScanOpts, ScanResult } from './messaging';

const SAMPLER_FILE = '/content-scripts/sampler.js';
const THUMB_WIDTH = 640;
const MAX_CSS_BYTES = 2_000_000;
const MAX_CSS_URLS = 24;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Downscale a captured data URL to a 640px-wide JPEG (q=0.7) data URL. */
async function downscale(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const w = Math.min(THUMB_WIDTH, bmp.width);
  const h = Math.max(1, Math.round((bmp.height * w) / bmp.width));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return `data:image/jpeg;base64,${toBase64(new Uint8Array(await out.arrayBuffer()))}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` with `prefers-color-scheme` emulated through the DevTools protocol. Needs the optional
 * `debugger` permission (requested from the side panel). Chrome shows its "debugging this
 * browser" bar while attached; we always restore and detach.
 */
async function withColorSchemeEmulation<T>(
  tabId: number,
  scheme: 'dark' | 'light',
  fn: () => Promise<T>,
): Promise<T> {
  const dbg = (chrome as { debugger?: typeof chrome.debugger }).debugger;
  if (!dbg) throw new Error('Debugger permission not granted');
  const target = { tabId };
  await dbg.attach(target, '1.3');
  try {
    await dbg.sendCommand(target, 'Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    });
    await sleep(400); // let transitions and media-query listeners settle
    return await fn();
  } finally {
    await dbg.sendCommand(target, 'Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
    await dbg.detach(target).catch(() => {});
  }
}

async function sample(tabId: number, opts: ScanOpts): Promise<ScanResult['raw']> {
  // Hand the options to the sampler, which runs in the same isolated world a moment later.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (o: Pick<ScanOpts, 'theme' | 'colorsOnly' | 'skipComponents'>) => {
      (globalThis as { __specimenOpts?: unknown }).__specimenOpts = o;
    },
    args: [{ theme: opts.theme, colorsOnly: opts.colorsOnly, skipComponents: opts.skipComponents }],
  });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    files: [SAMPLER_FILE],
  });
  const raw = injection?.result as ScanResult['raw'] | undefined;
  if (!raw) throw new Error('sampler returned no result');
  return raw;
}

export async function scanRun(tabId: number, opts: ScanOpts = {}): Promise<ScanResult> {
  const tab = await chrome.tabs.get(tabId);
  const raw = opts.emulate
    ? await withColorSchemeEmulation(tabId, opts.emulate, () => sample(tabId, opts))
    : await sample(tabId, opts);
  if (opts.noScreenshot) return { raw, screenshot: '' };
  // The thumbnail is a nice-to-have: a failed capture must not fail the scan.
  try {
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    return { raw, screenshot: await downscale(shot) };
  } catch (e) {
    raw.warnings.push(`screenshot unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return { raw, screenshot: '' };
  }
}

/** Fetch stylesheet text only for origins we hold host permission for; others → null. */
export async function cssFetch(urls: string[]): Promise<(string | null)[]> {
  return Promise.all(
    urls.slice(0, MAX_CSS_URLS).map(async (u) => {
      try {
        const url = new URL(u);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        if (!(await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))) return null;
        const res = await fetch(url.href, { credentials: 'omit' });
        if (!res.ok) return null;
        const text = await res.text();
        return text.length > MAX_CSS_BYTES ? text.slice(0, MAX_CSS_BYTES) : text;
      } catch {
        return null;
      }
    }),
  );
}

const OFFSCREEN_URL = 'offscreen.html';

/** Create the offscreen document unless one exists. Returns true when we created it. */
export async function ensureOffscreen(): Promise<boolean> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return false;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['WORKERS'],
      justification: 'Run the local Gemma model in a Web Worker',
    });
    return true;
  } catch (e) {
    // Lost a race with another creator: the document exists now, which is all we need.
    if (e instanceof Error && /single offscreen|already exists/i.test(e.message)) return false;
    throw e;
  }
}
