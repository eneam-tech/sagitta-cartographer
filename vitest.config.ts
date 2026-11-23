import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'playwright-report/**', 'test-results/**'],
    fileParallelism: false,
    testTimeout: 30_000
  }
});
