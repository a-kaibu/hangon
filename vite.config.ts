import { defineConfig } from 'vite-plus';

export default defineConfig({
  // GitHub Pages (https://a-kaibu.github.io/hangon/) でもローカルでも動くよう相対パス
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    // Three.js を含むため
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ['test/**/*.test.js'],
    testTimeout: 120000,
  },
  lint: {
    ignorePatterns: ['dist/**'],
  },
  fmt: {
    semi: true,
    singleQuote: true,
    printWidth: 140,
    ignorePatterns: ['dist/**'],
  },
});
