/**
 * Guards for the mobile capture when it runs inside the user's own tab (full screen) or a
 * temporary popup: one emulation at a time, desktop scans wait for it, and anything a closed
 * side panel left behind (an attached debugger with a phone override, a popup) is undone on the
 * next panel start.
 */

const KEY_TAB = 'mobile.emulatingTab';
const KEY_WINDOW = 'mobile.window';

let idle: Promise<void> = Promise.resolve();

/** Run `fn` while no other emulation runs on a user's tab; desktop scans wait for it. */
export function withTabEmulation<T>(fn: () => Promise<T>): Promise<T> {
  const run = idle.then(fn);
  idle = run.then(
    () => {},
    () => {},
  );
  return run;
}

/** Resolves once no emulation is running: a desktop scan must never read the phone override. */
export function tabEmulationIdle(): Promise<void> {
  return idle;
}

async function remember(key: string, id: number | null): Promise<void> {
  try {
    if (id === null) await chrome.storage.session.remove(key);
    else await chrome.storage.session.set({ [key]: id });
  } catch {
    /* no session storage: recovery just has nothing to go on */
  }
}

/** Record (or clear, with null) the user's tab that carries our debugger and phone override. */
export const rememberEmulatedTab = (tabId: number | null) => remember(KEY_TAB, tabId);
/** Record (or clear, with null) the temporary mobile popup. */
export const rememberMobileWindow = (windowId: number | null) => remember(KEY_WINDOW, windowId);

/**
 * On side-panel start: undo a mobile capture that a closed or reloaded panel never finished.
 * Skipped while another side panel is open, since that one may be capturing right now.
 */
export async function recoverMobileCapture(): Promise<void> {
  try {
    const panels = await chrome.runtime.getContexts({
      contextTypes: ['SIDE_PANEL' as chrome.runtime.ContextType],
    });
    if (panels.length > 1) return;
    const got = await chrome.storage.session.get([KEY_TAB, KEY_WINDOW]);
    const tabId = got[KEY_TAB];
    const windowId = got[KEY_WINDOW];
    const dbg = (chrome as { debugger?: typeof chrome.debugger }).debugger;
    if (typeof tabId === 'number' && dbg) {
      const target = { tabId };
      await dbg.sendCommand(target, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
      await dbg.detach(target).catch(() => {});
    }
    if (typeof windowId === 'number') await chrome.windows.remove(windowId).catch(() => {});
    await chrome.storage.session.remove([KEY_TAB, KEY_WINDOW]);
  } catch {
    /* best effort: nothing to undo, or no API to undo it with */
  }
}
