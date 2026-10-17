/**
 * Recovery for the mobile capture's temporary popup: anything a closed side panel left behind is
 * undone on the next panel start.
 */

/** Written by versions before SPC-44 (phone emulation in the user's tab); only ever cleared now. */
const KEY_LEGACY_TAB = 'mobile.emulatingTab';
const KEY_WINDOW = 'mobile.window';

/** Record (or clear, with null) the temporary mobile popup. */
export async function rememberMobileWindow(windowId: number | null): Promise<void> {
  try {
    if (windowId === null) await chrome.storage.session.remove(KEY_WINDOW);
    else await chrome.storage.session.set({ [KEY_WINDOW]: windowId });
  } catch {
    /* no session storage: recovery just has nothing to go on */
  }
}

/**
 * On side-panel start: close a mobile popup that a closed or reloaded panel never finished.
 * Skipped while another side panel is open, since that one may be capturing right now.
 */
export async function recoverMobileCapture(): Promise<void> {
  try {
    const panels = await chrome.runtime.getContexts({
      contextTypes: ['SIDE_PANEL' as chrome.runtime.ContextType],
    });
    if (panels.length > 1) return;
    const got = await chrome.storage.session.get(KEY_WINDOW);
    const windowId = got[KEY_WINDOW];
    if (typeof windowId === 'number') await chrome.windows.remove(windowId).catch(() => {});
    await chrome.storage.session.remove([KEY_WINDOW, KEY_LEGACY_TAB]);
  } catch {
    /* best effort: nothing to undo, or no API to undo it with */
  }
}
