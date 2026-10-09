import { useEffect } from 'react';
import { runTabScan } from './runScan';
import { useStore } from './store';

const KEY = 'shortcut.pending';
const MAX_AGE_MS = 10_000;
/** StrictMode and storage events can fire together: only one consume at a time. */
let busy = false;

/** Alt+Shift+C: the background opens the panel and leaves a timestamp; scan and show Generate. */
async function consume(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const got = await chrome.storage.session.get(KEY);
    const at = got[KEY];
    if (typeof at !== 'number') return;
    await chrome.storage.session.remove(KEY);
    if (Date.now() - at > MAX_AGE_MS) return;
    const { setTab } = useStore.getState();
    // Asking for site access needs a click, so without it the user presses "Scan this page".
    if (!(await chrome.permissions.contains({ origins: ['<all_urls>'] }))) {
      setTab('scan');
      return;
    }
    setTab('generate');
    await runTabScan();
  } catch {
    /* storage.session unavailable: the shortcut just opens the panel */
  } finally {
    busy = false;
  }
}

export function useShortcut(): void {
  useEffect(() => {
    void consume();
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === 'session' && KEY in changes) void consume();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
}
