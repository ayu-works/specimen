import { describe, expect, it } from 'vitest';
import {
  decryptWithPassphrase,
  decryptWithRawKey,
  deriveRawKey,
  encryptWithPassphrase,
  encryptWithRawKey,
  randomSalt,
} from './crypto';

const KEY = 'sk-test-1234567890';

describe('secret encryption', () => {
  it('T3.10 round-trips with the right passphrase and never stores the plaintext', async () => {
    const rec = await encryptWithPassphrase(KEY, 'correct horse');
    expect(rec).toMatchObject({ v: 1, enc: true });
    expect(JSON.stringify(rec)).not.toContain(KEY);
    expect(await decryptWithPassphrase(rec, 'correct horse')).toBe(KEY);
  });

  it('T3.10 fails with a wrong passphrase', async () => {
    const rec = await encryptWithPassphrase(KEY, 'correct horse');
    await expect(decryptWithPassphrase(rec, 'wrong horse')).rejects.toBeDefined();
  });

  it('T3.10 uses a random salt and IV for every record', async () => {
    const a = await encryptWithPassphrase(KEY, 'pw');
    const b = await encryptWithPassphrase(KEY, 'pw');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(randomSalt()).not.toBe(randomSalt());
  });

  it('T3.10 a shared derived key gives a fresh IV per record and unlocks all of them', async () => {
    const salt = randomSalt();
    const raw = await deriveRawKey('pw', salt);
    const a = await encryptWithRawKey('one', raw, salt);
    const b = await encryptWithRawKey('one', raw, salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(await decryptWithRawKey(a, raw)).toBe('one');
    expect(await decryptWithRawKey(b, raw)).toBe('one');
  });

  it('T3.10 detects tampering', async () => {
    const rec = await encryptWithPassphrase(KEY, 'pw');
    const flipped = { ...rec, ct: `${rec.ct.startsWith('A') ? 'B' : 'A'}${rec.ct.slice(1)}` };
    await expect(decryptWithPassphrase(flipped, 'pw')).rejects.toBeDefined();
  });
});
