/** AES-GCM + PBKDF2 helpers for the optional "encrypt keys with a passphrase" feature (WebCrypto only). */

export const PBKDF2_ITERATIONS = 250_000;

export interface EncryptedSecret {
  v: 1;
  enc: true;
  /** base64 */
  salt: string;
  iv: string;
  ct: string;
  iterations: number;
}

export interface PlainSecret {
  v: 1;
  enc: false;
  key: string;
}

export type StoredSecret = EncryptedSecret | PlainSecret;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomSalt(): string {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

/** Derive a non-extractable-by-default AES key; `raw` mode exports it for the session cache. */
export async function deriveRawKey(
  passphrase: string,
  saltB64: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' },
    base,
    256,
  );
  return b64(new Uint8Array(bits));
}

async function importAes(rawB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unb64(rawB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypt with an already-derived key (so one passphrase unlocks every stored key). */
export async function encryptWithRawKey(
  plain: string,
  rawKeyB64: string,
  saltB64: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await importAes(rawKeyB64),
    new TextEncoder().encode(plain),
  );
  return { v: 1, enc: true, salt: saltB64, iv: b64(iv), ct: b64(new Uint8Array(ct)), iterations };
}

/** Decrypt with a derived key. Throws if the passphrase (key) is wrong. */
export async function decryptWithRawKey(
  secret: EncryptedSecret,
  rawKeyB64: string,
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(secret.iv) },
    await importAes(rawKeyB64),
    unb64(secret.ct),
  );
  return new TextDecoder().decode(pt);
}

/** Convenience: derive from a passphrase (fresh random salt) and encrypt. */
export async function encryptWithPassphrase(
  plain: string,
  passphrase: string,
): Promise<EncryptedSecret> {
  const salt = randomSalt();
  return encryptWithRawKey(plain, await deriveRawKey(passphrase, salt), salt);
}

/** Convenience: derive from the stored salt and decrypt. */
export async function decryptWithPassphrase(
  secret: EncryptedSecret,
  passphrase: string,
): Promise<string> {
  return decryptWithRawKey(secret, await deriveRawKey(passphrase, secret.salt, secret.iterations));
}
