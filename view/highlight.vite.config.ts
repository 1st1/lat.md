import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const highlightLicense = readFileSync(
  join(dirname(require.resolve('highlight.js/package.json')), 'LICENSE'),
  'utf8',
).trim();
const lowlightLicense = readFileSync(
  join(dirname(require.resolve('lowlight')), 'license'),
  'utf8',
).trim();

export default defineConfig({
  plugins: [
    {
      name: 'highlight-license',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type === 'chunk') {
            output.code = `/*!\nHighlight.js:\n${highlightLicense}\n\nLowlight:\n${lowlightLicense}\n*/\n${output.code}`;
          }
        }
      },
    },
  ],
  build: {
    target: 'es2022',
    outDir: fileURLToPath(new URL('../dist/src/view', import.meta.url)),
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: false,
    minify: 'esbuild',
    lib: {
      entry: fileURLToPath(
        new URL('../src/view/highlight.ts', import.meta.url),
      ),
      formats: ['es'],
      fileName: () => 'highlight.js',
    },
    rollupOptions: {
      external: ['node:path'],
    },
  },
});
