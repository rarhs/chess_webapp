import { defineConfig } from 'vite';

// Relative base so the built site works from any folder or subpath on a static host.
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
  },
});
