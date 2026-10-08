import { type DesignScan, DesignScanSchema } from './scan';

/**
 * Upgrade any stored/imported scan to the current schema version.
 *  - v1 -> v2: no-op; v2 only adds the optional `variants.light`.
 * Unknown (newer) versions are rejected with a clear message.
 */
export function migrate(input: unknown): DesignScan {
  let data = input;
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    if (rec.schemaVersion === 1) data = { ...rec, schemaVersion: 2 };
    else if (typeof rec.schemaVersion === 'number' && rec.schemaVersion > 2) {
      throw new Error(`Unsupported scan version ${rec.schemaVersion}; update Specimen.`);
    }
  }
  return DesignScanSchema.parse(data);
}
