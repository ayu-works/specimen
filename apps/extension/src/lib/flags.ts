import { useEffect, useState } from 'react';

/**
 * Experimental feature flags in `chrome.storage.local` under `flags.<name>`. Off unless the
 * stored value is exactly `true`; any read failure means off.
 */
export type FlagName = 'critique';

export const flagKey = (name: FlagName): string => `flags.${name}`;

export async function loadFlag(name: FlagName): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get(flagKey(name));
    return got[flagKey(name)] === true;
  } catch {
    return false;
  }
}

export async function setFlag(name: FlagName, on: boolean): Promise<void> {
  if (on) await chrome.storage.local.set({ [flagKey(name)]: true });
  else await chrome.storage.local.remove(flagKey(name));
}

/** Fire `cb` with the new value whenever the flag changes in storage. */
export function watchFlag(name: FlagName, cb: (on: boolean) => void): () => void {
  const key = flagKey(name);
  const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && key in changes) cb(changes[key]?.newValue === true);
  };
  try {
    chrome.storage.onChanged.addListener(onChange);
  } catch {
    return () => {};
  }
  return () => chrome.storage.onChanged.removeListener(onChange);
}

/** The flag's value, or null until it has been read (treat null as off, but don't act on it). */
export function useFlag(name: FlagName): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void loadFlag(name).then((v) => {
      if (live) setOn(v);
    });
    const stop = watchFlag(name, setOn);
    return () => {
      live = false;
      stop();
    };
  }, [name]);
  return on;
}
