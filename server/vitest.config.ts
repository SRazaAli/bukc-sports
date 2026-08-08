import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false, // tests share one DB; run serially
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
