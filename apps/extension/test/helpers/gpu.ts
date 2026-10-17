/** How `navigator.gpu` looks to the code under test. */
export type GpuMode = 'present' | 'absent' | 'no-adapter' | 'throws';

/**
 * Define (or delete) `navigator.gpu` for one test, and return a restore function. Opt-in: tests
 * that never call it see whatever their environment set up.
 */
export function stubGpu(mode: GpuMode): () => void {
  const before = Object.getOwnPropertyDescriptor(navigator, 'gpu');
  Reflect.deleteProperty(navigator, 'gpu');
  if (mode !== 'absent') {
    const requestAdapter = async () => {
      if (mode === 'throws') throw new Error('requestAdapter failed');
      return mode === 'present' ? {} : null;
    };
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter } });
  }
  return () => {
    Reflect.deleteProperty(navigator, 'gpu');
    if (before) Object.defineProperty(navigator, 'gpu', before);
  };
}
