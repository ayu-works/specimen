import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  // Bundle core (and its zod/culori deps) so the published package is self-contained.
  noExternal: ['@specimen/core'],
  banner: { js: '#!/usr/bin/env node' },
});
