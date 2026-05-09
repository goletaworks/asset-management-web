import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.{js,mjs,cjs}'],
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
