import { z } from 'zod';

/**
 * Size bounds of a v5 `DesignScan` (max chars for strings, max entries for arrays and records),
 * well above real scans. The schema, `trimToBounds` and the tests all read this one table.
 */
export const BOUNDS = {
  title: 1000,
  url: 2048,
  host: 253,
  palette: 512,
  cssVariables: 500,
  cssVarKey: 200,
  cssVarValue: 500,
  families: 50,
  styles: 200,
  sample: 200,
  blueprint: 500,
  warnings: 100,
  warning: 500,
  pages: 50,
  vibeSummary: 4000,
  keywords: 50,
  keyword: 100,
  /** Every other array or record. */
  list: 200,
  /** Every other free string (css, easings, names, ids, component values). */
  text: 1000,
  /** Scans in one `.specimen.json` import file. */
  importScans: 500,
} as const;

/** Each bounded schema node and its bound, so `trimToBounds` reads the same numbers the schema checks. */
export const MAX = new WeakMap<z.ZodType, number>();

export function bounded<T extends z.ZodType>(schema: T, max: number): T {
  MAX.set(schema, max);
  return schema;
}

export const str = (max: number = BOUNDS.text) => bounded(z.string().max(max), max);

export const list = <T extends z.ZodType>(item: T, max: number = BOUNDS.list) =>
  bounded(z.array(item).max(max), max);

export const dict = <K extends z.ZodType<string>, V extends z.ZodType>(
  key: K,
  value: V,
  max: number = BOUNDS.list,
) =>
  bounded(
    z.record(key, value).refine((r) => Object.keys(r).length <= max, `at most ${max} entries`),
    max,
  );
