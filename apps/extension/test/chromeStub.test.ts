import { describe, expect, it } from 'vitest';
import { makeChrome, NOT_IN_MANIFEST } from './helpers/chrome';

const notInManifest = { permissions: ['tabCapture'] };
const origin = { origins: ['https://api.example.com/*'] };

describe('shared chrome stub: permissions that can say no', () => {
  it('T3.13 by default everything is held and every request is granted (unchanged)', async () => {
    const { permissions } = makeChrome();
    expect(await permissions.contains(notInManifest)).toBe(true);
    expect(await permissions.contains(origin)).toBe(true);
    expect(await permissions.request(origin)).toBe(true);
  });

  it('T3.13 deny: nothing held, the request answers false and grants nothing', async () => {
    const { permissions } = makeChrome({ permissions: { held: {}, answer: 'deny' } });
    expect(await permissions.contains(origin)).toBe(false);
    expect(await permissions.request(origin)).toBe(false);
    expect(await permissions.contains(origin)).toBe(false);
  });

  it('T3.13 grant: a granted request is held afterwards; remove takes it back', async () => {
    const { permissions } = makeChrome({ permissions: { held: {} } });
    expect(await permissions.request(origin)).toBe(true);
    expect(await permissions.contains(origin)).toBe(true);
    expect(permissions.held.origins.has('https://api.example.com/*')).toBe(true);
    await permissions.remove(origin);
    expect(await permissions.contains(origin)).toBe(false);
  });

  it("T3.13 throw: rejects with Chrome's message; what is held still answers true", async () => {
    const { permissions } = makeChrome({
      permissions: { held: { permissions: ['storage'] }, answer: 'throw' },
    });
    await expect(permissions.request(notInManifest)).rejects.toThrow(NOT_IN_MANIFEST);
    expect(await permissions.request({ permissions: ['storage'] })).toBe(true);
  });

  it('T3.13 a held <all_urls> covers any origin; a held origin covers only itself', async () => {
    const all = makeChrome({ permissions: { held: { origins: ['<all_urls>'] }, answer: 'deny' } });
    expect(await all.permissions.contains(origin)).toBe(true);
    const one = makeChrome({ permissions: { held: origin, answer: 'deny' } });
    expect(await one.permissions.contains({ origins: ['https://other.example/*'] })).toBe(false);
  });
});
