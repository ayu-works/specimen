import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearProviders,
  getActiveProvider,
  getProvider,
  listProviders,
  registerProvider,
  setActiveProvider,
  unregisterProvider,
} from './registry';
import { createMockProvider } from './testing/mockProvider';

beforeEach(() => clearProviders());

describe('provider registry', () => {
  it('T3.01 registers, gets and lists providers; the default active provider is none', () => {
    expect(listProviders()).toEqual([]);
    expect(getActiveProvider()).toBeNull();

    const a = createMockProvider({ id: 'a' });
    const b = createMockProvider({ id: 'b' });
    registerProvider(a);
    registerProvider(b);

    expect(getProvider('a')).toBe(a);
    expect(getProvider('missing')).toBeUndefined();
    expect(listProviders().map((p) => p.id)).toEqual(['a', 'b']);
    // Registering never activates anything.
    expect(getActiveProvider()).toBeNull();
  });

  it('T3.01 activates only registered ids and clears on unregister', () => {
    const a = createMockProvider({ id: 'a' });
    registerProvider(a);
    setActiveProvider('nope');
    expect(getActiveProvider()).toBeNull();
    setActiveProvider('a');
    expect(getActiveProvider()).toBe(a);
    unregisterProvider('a');
    expect(getActiveProvider()).toBeNull();
    expect(listProviders()).toEqual([]);
    setActiveProvider(null);
    expect(getActiveProvider()).toBeNull();
  });

  it('T3.01 re-registering an id replaces the provider', () => {
    registerProvider(createMockProvider({ id: 'a', label: 'one' }));
    const two = createMockProvider({ id: 'a', label: 'two' });
    registerProvider(two);
    expect(listProviders()).toHaveLength(1);
    expect(getProvider('a')).toBe(two);
  });
});
