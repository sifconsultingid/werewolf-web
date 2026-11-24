import { defineConfig } from 'vite';

// base './' agar hasil build bisa di-host di subfolder (mis. GitHub Pages).
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
} as any);
