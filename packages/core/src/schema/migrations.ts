import { type DesignScan, DesignScanSchema } from './scan';

/**
 * Upgrade any stored/imported scan to the current schema version.
 * Only v1 exists today; future versions add `case N:` steps that transform to N+1.
 */
export function migrate(input: unknown): DesignScan {
  return DesignScanSchema.parse(input);
}
