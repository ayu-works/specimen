import { describe, expect, it } from 'vitest';
import { VERSION } from './index';

describe('core', () => {
  it('T0.01 core exports a version string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
