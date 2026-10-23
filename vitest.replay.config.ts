import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The capture replay (`scripts/replay/capture.replay.ts`), run by
 * `npm run replay`: not a test, so never in the suite, but run under vitest for
 * its clock, which lets a half-hour capture replay in seconds.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['scripts/replay/*.replay.ts'],
    exclude: ['**/node_modules/**']
  }
});
