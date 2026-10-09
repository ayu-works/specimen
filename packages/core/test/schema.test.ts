import { describe, expect, it } from 'vitest';
import { DesignScanSchema, migrate, RawPageSchema, SCHEMA_VERSION } from '../src/schema';
import minimalRaw from './fixtures/minimal-raw.json';
import minimalScan from './fixtures/minimal-scan.json';

describe('schemas', () => {
  it('T1.01 RawPage and DesignScan schemas round-trip fixtures and reject missing fields', () => {
    expect(SCHEMA_VERSION).toBe(minimalScan.schemaVersion);

    const raw = RawPageSchema.parse(minimalRaw);
    expect(RawPageSchema.parse(JSON.parse(JSON.stringify(raw)))).toEqual(raw);

    const scan = DesignScanSchema.parse(minimalScan);
    expect(DesignScanSchema.parse(JSON.parse(JSON.stringify(scan)))).toEqual(scan);
    expect(migrate(minimalScan)).toEqual(scan);

    // missing required fields are rejected
    const { url: _url, ...rawNoUrl } = minimalRaw;
    expect(RawPageSchema.safeParse(rawNoUrl).success).toBe(false);
    const { samples: _samples, ...rawNoSamples } = minimalRaw;
    expect(RawPageSchema.safeParse(rawNoSamples).success).toBe(false);

    const { colors: _colors, ...scanNoColors } = minimalScan;
    expect(DesignScanSchema.safeParse(scanNoColors).success).toBe(false);
    expect(DesignScanSchema.safeParse({ ...minimalScan, schemaVersion: SCHEMA_VERSION - 1 }).success,
    ).toBe(false);

    // older stored scans (v1, v2) upgrade to the current version
    for (const v of [1, 2]) {
      expect(migrate({ ...minimalScan, schemaVersion: v }).schemaVersion).toBe(SCHEMA_VERSION);
    }
    expect(() => migrate({ ...minimalScan, schemaVersion: SCHEMA_VERSION + 1 })).toThrow();
    expect(() => migrate({})).toThrow();
  });
});
