import { defineConfig } from 'vitest/config';

export default defineConfig({
  // src/Root.tsx is JSX; the test reads its <Composition> elements without rendering them.
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
