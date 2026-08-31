import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const viewRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: viewRoot,
  // Lazy chunks and their CSS resolve from the entry asset at any static base.
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/src/view/client', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
