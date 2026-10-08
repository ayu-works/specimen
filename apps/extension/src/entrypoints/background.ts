import { listen, type Message, type ScanResult } from '@/lib/messaging';

const SAMPLER_FILE = '/content-scripts/sampler.js';
const OVERLAY_FILE = '/content-scripts/overlay.js';
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

async function scanRun(tabId: number): Promise<ScanResult> {
  const tab = await chrome.tabs.get(tabId);
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    files: [SAMPLER_FILE],
  });
  const raw = injection?.result as ScanResult['raw'] | undefined;
  if (!raw) throw new Error('sampler returned no result');
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
  return { raw, screenshot: await downscale(shot) };
}

/** Fetch stylesheet text only for origins we hold host permission for; others → null. */
async function cssFetch(urls: string[]): Promise<(string | null)[]> {
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

/** Inject the overlay on demand (idempotent in the script) and forward the toggle to the tab. */
async function overlaySet(msg: Extract<Message, { type: 'overlay.set' }>): Promise<{ ok: true }> {
  await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: [OVERLAY_FILE] });
  await chrome.tabs.sendMessage(msg.tabId, msg);
  return { ok: true };
}

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  listen({
    'scan.run': (msg) => scanRun(msg.tabId),
    'overlay.set': overlaySet,
    'css.fetch': async (msg) => ({ texts: await cssFetch(msg.urls) }),
  });
});
