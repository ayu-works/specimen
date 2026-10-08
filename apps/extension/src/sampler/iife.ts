// Entry for the standalone IIFE bundle (Playwright tests, `pnpm capture`). Not used by the extension.
import { RawPageSchema } from '@specimen/core/schema';
import { type SampleOptions, samplePage } from './index';

(globalThis as Record<string, unknown>).__specimenSample = (opts: SampleOptions = {}) =>
  samplePage({ validate: (raw) => void RawPageSchema.parse(raw), ...opts });
