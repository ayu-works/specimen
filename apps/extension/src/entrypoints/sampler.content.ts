import { send } from '@/lib/messaging';
import { samplePage } from '../sampler';

// Injected on demand by the background (`scripting.executeScript`), never declared in the manifest.
export default defineContentScript({
  registration: 'runtime',
  matches: [],
  async main() {
    let validate: ((raw: import('@specimen/core/schema').RawPage) => void) | undefined;
    if (import.meta.env.DEV) {
      const { RawPageSchema } = await import('@specimen/core/schema');
      validate = (raw) => void RawPageSchema.parse(raw);
    }
    return samplePage({
      validate,
      fetchCss: async (urls) => (await send('css.fetch', { urls })).texts,
    });
  },
});
