import { extract, generatePrompt, PROMPT_TARGETS, type PromptTarget } from '@specimen/core';
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

const DEFAULT_TARGET: PromptTarget = 'claude-code';
const OFFSCREEN_URL = 'offscreen.html';
const BADGE_MS = 2000;

async function storedTarget(): Promise<PromptTarget> {
  try {
    const got = await chrome.storage.local.get('settings.promptTarget');
    const v = got['settings.promptTarget'] as PromptTarget | undefined;
    if (v && PROMPT_TARGETS.includes(v)) return v;
  } catch {
    /* storage unavailable: use the default */
  }
  return DEFAULT_TARGET;
}

/** Create the offscreen document unless one exists. Returns true when we created it. */
async function ensureOffscreen(): Promise<boolean> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return false;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      // Reasons are fixed at creation and only one offscreen document can exist, so declare both.
      reasons: ['CLIPBOARD', 'WORKERS'],
      justification: 'Copy the generated prompt and run the local Gemma model in a Web Worker',
    });
    return true;
  } catch (e) {
    // Lost a race with another creator: the document exists now, which is all we need.
    if (e instanceof Error && /single offscreen|already exists/i.test(e.message)) return false;
    throw e;
  }
}

async function copyViaOffscreen(text: string): Promise<void> {
  const created = await ensureOffscreen();
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'offscreen.copy', text })) as
      | { ok: boolean; error?: string }
      | undefined;
    if (!res?.ok) throw new Error(res?.error ?? 'copy failed');
  } finally {
    if (created && !(await offscreenBusy())) {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
  }
}

/** A loaded/loading local model (or a connected client) keeps the document alive. */
async function offscreenBusy(): Promise<boolean> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'offscreen.busy' })) as
      | { ok: boolean; data?: { busy: boolean } }
      | undefined;
    // No answer means we can't prove it's idle: leave it open.
    return res?.data?.busy ?? true;
  } catch {
    return true;
  }
}

function flashBadge(text: string, color: string): void {
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: '' }), BADGE_MS);
}

/** Keyboard shortcut: scan the active tab and copy the AI prompt to the clipboard. */
async function scanAndCopy(commandTab?: chrome.tabs.Tab): Promise<void> {
  try {
    const tab =
      commandTab?.id !== undefined
        ? commandTab
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (tab?.id === undefined) throw new Error('No active tab');
    if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('Unsupported page');
    const { raw } = await scanRun(tab.id);
    const prompt = generatePrompt(extract(raw), { target: await storedTarget() });
    await copyViaOffscreen(prompt.content);
    flashBadge('✓', '#16a34a');
  } catch {
    flashBadge('!', '#dc2626');
  }
}

export default defineBackground(() => {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'scan-copy') void scanAndCopy(tab);
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  listen({
    'scan.run': (msg) => scanRun(msg.tabId),
    'overlay.set': overlaySet,
    'offscreen.ensure': async () => {
      await ensureOffscreen();
      return { ok: true };
    },
    'css.fetch': async (msg) => ({ texts: await cssFetch(msg.urls) }),
  });
});
