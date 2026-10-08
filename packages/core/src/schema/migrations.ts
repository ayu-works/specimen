import { type DesignScan, DesignScanSchema } from './scan';

/** The newest version this build understands. */
const CURRENT = 3;

/**
 * Upgrade any stored/imported scan to the current schema version.
 *  - v1 -> v2: no-op; v2 only adds the optional `variants.light`.
 *  - v2 -> v3: no-op; v3 only adds optional fields (`variants.mobile` details, theme
 *    `measured` flag, richer `a11y` pairs).
 * Unknown (newer) versions are rejected with a clear message.
 */
export function migrate(input: unknown): DesignScan {
  let data = input;
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    if (rec.schemaVersion === 1 || rec.schemaVersion === 2)
      data = { ...rec, schemaVersion: CURRENT };
    else if (typeof rec.schemaVersion === 'number' && rec.schemaVersion > CURRENT) {
      throw new Error(`Unsupported scan version ${rec.schemaVersion}; update Specimen.`);
    }
  }
  return DesignScanSchema.parse(data);
}
