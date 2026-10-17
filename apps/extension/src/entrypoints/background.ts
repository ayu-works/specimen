import { cssFetch, ensureOffscreen, scanRun } from '@/lib/backgroundScan';
import { chromeCouncilGuard } from '@/lib/councilGuard';
import { listen, type Message } from '@/lib/messaging';

declare const __SPECIMEN_E2E__: boolean;

const OVERLAY_FILE = '/content-scripts/overlay.js';

/** Inject the overlay on demand (idempotent in the script) and forward the toggle to the tab. */
async function overlaySet(msg: Extract<Message, { type: 'overlay.set' }>): Promise<{ ok: true }> {
  await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: [OVERLAY_FILE] });
  await chrome.tabs.sendMessage(msg.tabId, msg);
  return { ok: true };
}

/** Key the side panel watches: a recent timestamp means "the shortcut asked for a scan". */
const SHORTCUT_KEY = 'shortcut.pending';

function markShortcut(): void {
  chrome.storage.session.set({ [SHORTCUT_KEY]: Date.now() }).catch(() => {});
}

export default defineBackground(() => {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== 'scan-generate') return;
    markShortcut();
    // No await before this: opening the panel needs the shortcut's user gesture.
    if (tab?.windowId !== undefined)
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // The council (SPC-24) runs in the offscreen document; the SW stops it when the flag, the
  // provider or a key changes (no panel needed), and owns the badge.
  const council = chromeCouncilGuard();
  chrome.storage.onChanged.addListener((changes, area) => {
    void council.onStorageChanged(changes, area);
  });
  chrome.runtime.onStartup.addListener(() => void council.onStartup());
  chrome.runtime.onInstalled.addListener(() => void council.onStartup());
  listen({
    'council.started': async (msg) => {
      await council.onRuntime({ type: 'council.started', runId: msg.runId });
      return { ok: true };
    },
    'council.finished': async (msg) => {
      await council.onRuntime({ type: 'council.finished', runId: msg.runId, status: msg.status });
      return { ok: true };
    },
    'scan.run': (msg) => scanRun(msg.tabId, msg.opts),
    'overlay.set': overlaySet,
    'offscreen.ensure': async () => {
      await ensureOffscreen();
      return { ok: true };
    },
    'css.fetch': async (msg) => ({ texts: await cssFetch(msg.urls) }),
    // Test hook, compiled into the SPECIMEN_E2E=1 build only.
    ...(__SPECIMEN_E2E__
      ? {
          'test.shortcut': async () => {
            markShortcut();
            return { ok: true as const };
          },
        }
      : {}),
  });
});
