import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve('app/main/index.ts') } } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('app/preload/index.ts') },
        // Con sandbox, el preload debe ser CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'app/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('app/renderer/index.html') } } },
  },
});
