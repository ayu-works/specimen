/**
 * AI settings + secret storage (ARCHITECTURE §9).
 * Settings live in `chrome.storage.local` under `settings.ai`. API keys live under
 * `secrets.<preset>` in `chrome.storage.local` only (never `storage.sync`), optionally
 * AES-GCM encrypted with a PBKDF2-derived key. The derived key (never the passphrase) is cached in
 * `chrome.storage.session` so the user unlocks once per browser session.
 */
import {
  decryptWithRawKey,
  deriveRawKey,
  type EncryptedSecret,
  encryptWithRawKey,
  getPreset,
  randomSalt,
  type StoredSecret,
} from '@specimen/ai';
import { DEFAULT_GEMMA } from './gemmaModels';

export type AiProviderId = 'none' | 'webllm' | 'chrome' | 'byok';

export interface AiSettings {
  provider: AiProviderId;
  webllmModel: string;
  byok: {
    preset: string;
    baseUrl: string;
    model: string;
    /** Storage key of the secret, `secrets.<preset>`. */
    keyRef: string;
    /** Override whether the model accepts images (defaults to the preset's value). */
    vision?: boolean;
  };
  /** Encrypt keys with a passphrase when saving. */
  encryptKeys: boolean;
  /** Model ids whose weights we downloaded (hint for the header chip; the cache is the truth). */
  downloaded: string[];
}

export const KEY_AI = 'settings.ai';
export const SECRET_PREFIX = 'secrets.';
const SESSION_KEY = 'session.vaultKey';

export function secretKey(preset: string): string {
  return `${SECRET_PREFIX}${preset}`;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'none',
  webllmModel: DEFAULT_GEMMA,
  byok: { preset: 'anthropic', baseUrl: '', model: '', keyRef: secretKey('anthropic') },
  encryptKeys: false,
  downloaded: [],
};

export async function loadAiSettings(): Promise<AiSettings> {
  try {
    const got = await chrome.storage.local.get(KEY_AI);
    const s = got[KEY_AI] as Partial<AiSettings> | undefined;
    return {
      ...DEFAULT_AI_SETTINGS,
      ...s,
      byok: { ...DEFAULT_AI_SETTINGS.byok, ...s?.byok },
      downloaded: s?.downloaded ?? [],
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const cur = await loadAiSettings();
  const next: AiSettings = {
    ...cur,
    ...patch,
    byok: { ...cur.byok, ...patch.byok },
  };
  next.byok.keyRef = secretKey(next.byok.preset);
  await chrome.storage.local.set({ [KEY_AI]: next });
  return next;
}

/** Fire `cb` when AI settings, any stored key or the session unlock changes. */
export function watchAi(cb: () => void): () => void {
  const onChange = (changes: Record<string, unknown>, area: string) => {
    if (area === 'session' && SESSION_KEY in changes) return cb();
    if (
      area === 'local' &&
      Object.keys(changes).some((k) => k === KEY_AI || k.startsWith(SECRET_PREFIX))
    ) {
      cb();
    }
  };
  chrome.storage.onChanged.addListener(onChange);
  return () => chrome.storage.onChanged.removeListener(onChange);
}

// ---------- secrets ----------

interface VaultKey {
  salt: string;
  raw: string;
}

async function sessionVault(): Promise<VaultKey | null> {
  try {
    const got = await chrome.storage.session.get(SESSION_KEY);
    return (got[SESSION_KEY] as VaultKey | undefined) ?? null;
  } catch {
    return null;
  }
}

async function readSecret(preset: string): Promise<StoredSecret | null> {
  const got = await chrome.storage.local.get(secretKey(preset));
  return (got[secretKey(preset)] as StoredSecret | undefined) ?? null;
}

/** Salt shared by every encrypted key, so one passphrase unlocks them all. */
async function existingVaultSalt(): Promise<string | null> {
  const all = await chrome.storage.local.get(null);
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(SECRET_PREFIX) && (v as StoredSecret).enc) return (v as EncryptedSecret).salt;
  }
  return null;
}

export type KeyState = { status: 'none' } | { status: 'locked' } | { status: 'ok'; key: string };

export async function loadKey(preset: string): Promise<KeyState> {
  const s = await readSecret(preset);
  if (!s) return { status: 'none' };
  if (!s.enc) return { status: 'ok', key: s.key };
  const vault = await sessionVault();
  if (!vault || vault.salt !== s.salt) return { status: 'locked' };
  try {
    return { status: 'ok', key: await decryptWithRawKey(s, vault.raw) };
  } catch {
    return { status: 'locked' };
  }
}

export async function isEncrypted(preset: string): Promise<boolean> {
  return (await readSecret(preset))?.enc ?? false;
}

/**
 * Store a key. With `passphrase` it is encrypted; otherwise stored as plain text in
 * `storage.local` (which is only readable by this extension).
 */
export async function saveKey(preset: string, key: string, passphrase?: string): Promise<void> {
  let record: StoredSecret;
  if (passphrase) {
    const salt = (await existingVaultSalt()) ?? randomSalt();
    const raw = await deriveRawKey(passphrase, salt);
    const vault = await sessionVault();
    if (!vault || vault.salt !== salt) {
      // Prove the passphrase matches any key already encrypted with this salt.
      const all = await chrome.storage.local.get(null);
      for (const [k, v] of Object.entries(all)) {
        if (
          k.startsWith(SECRET_PREFIX) &&
          (v as StoredSecret).enc &&
          (v as EncryptedSecret).salt === salt
        ) {
          try {
            await decryptWithRawKey(v as EncryptedSecret, raw);
          } catch {
            throw new Error(
              'That passphrase does not match the one used for your other saved keys.',
            );
          }
          break;
        }
      }
    }
    record = await encryptWithRawKey(key, raw, salt);
    await chrome.storage.session.set({ [SESSION_KEY]: { salt, raw } satisfies VaultKey });
  } else {
    record = { v: 1, enc: false, key };
  }
  await chrome.storage.local.set({ [secretKey(preset)]: record });
}

export async function removeKey(preset: string): Promise<void> {
  await chrome.storage.local.remove(secretKey(preset));
}

/** Unlock encrypted keys for this browser session. Resolves false on a wrong passphrase. */
export async function unlockKeys(preset: string, passphrase: string): Promise<boolean> {
  const s = await readSecret(preset);
  if (!s?.enc) return true;
  const raw = await deriveRawKey(passphrase, s.salt, s.iterations);
  try {
    await decryptWithRawKey(s, raw);
  } catch {
    return false;
  }
  await chrome.storage.session.set({ [SESSION_KEY]: { salt: s.salt, raw } satisfies VaultKey });
  return true;
}

// ---------- host permission ----------

export function originPattern(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

/** Ask for the optional host permission for the provider origin. Call inside a click handler. */
export async function requestProviderPermission(baseUrl: string): Promise<boolean> {
  const origin = originPattern(baseUrl);
  if (!origin) return false;
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

export function presetBase(presetId: string, baseUrl: string): string {
  const p = getPreset(presetId);
  return baseUrl || p?.baseUrl || '';
}
