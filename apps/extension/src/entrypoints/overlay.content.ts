import { initOverlay } from '@/overlay';

// Injected on demand by the background (`scripting.executeScript`), never declared in the manifest.
export default defineContentScript({
  registration: 'runtime',
  matches: [],
  main() {
    initOverlay();
  },
});
