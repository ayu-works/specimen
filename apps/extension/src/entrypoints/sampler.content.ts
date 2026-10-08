import { send } from '@/lib/messaging';
import { type SampleOptions, samplePage } from '../sampler';

/** Options the background hands over just before injecting (see `scan.run`). */
type Handover = Pick<SampleOptions, 'theme' | 'colorsOnly' | 'skipComponents'>;

// Injected on demand by the background (`scripting.executeScript`), never declared in the manifest.
export default defineContentScript({
  registration: 'runtime',
  matches: [],
  async main() {
    const g = globalThis as { __specimenOpts?: Handover };
    const handover = g.__specimenOpts ?? {};
    g.__specimenOpts = undefined;
    let validate: ((raw: import('@specimen/core/schema').RawPage) => void) | undefined;
    if (import.meta.env.DEV) {
      const { RawPageSchema } = await import('@specimen/core/schema');
      validate = (raw) => void RawPageSchema.parse(raw);
    }
    return samplePage({
      validate,
      theme: handover.theme,
      colorsOnly: handover.colorsOnly,
      skipComponents: handover.skipComponents,
      fetchCss: async (urls) => (await send('css.fetch', { urls })).texts,
    });
  },
});
