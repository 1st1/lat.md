import { describe, expect, it } from 'vitest';
import { nodeFileTrace } from '@vercel/nft';
import { fileURLToPath } from 'node:url';
// @ts-expect-error Build helpers are plain JavaScript so they can run before TypeScript compilation.
import { patchNodeGlue } from '../packages/embed/scripts/patch-node-glue.mjs';

const generatedLoader = `const wasmPath = \`${'${__dirname}'}/engine_bg.wasm\`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();`;

describe('embedding runtime assets', () => {
  // @lat: [[tests/search#Hybrid Retrieval#Packages stemmer runtime assets]]
  it('traces both stemmer glue and WASM for standalone server deployment', async () => {
    const { fileList } = await nodeFileTrace([
      fileURLToPath(
        new URL('../packages/stemmer/dist/index.js', import.meta.url),
      ),
    ]);
    for (const asset of ['engine.cjs', 'engine_bg.wasm'])
      expect(
        [...fileList].some((path) =>
          path.replaceAll('\\', '/').endsWith(`stemmer/dist/${asset}`),
        ),
      ).toBe(true);
  });
  // @lat: [[tests/search#RAG Tests#Patches generated WASM loading explicitly]]
  it('replaces wasm-bindgen filesystem loading with explicit initialization', () => {
    const patched = patchNodeGlue(`before\n${generatedLoader}\nafter`);

    expect(patched).not.toContain("require('fs').readFileSync");
    expect(patched).toContain('exports.__initialize = function(wasmBytes)');
    expect(patched).toContain('wasm.__wbindgen_start()');
    expect(patchNodeGlue(patched)).toBe(patched);
  });

  // @lat: [[tests/search#RAG Tests#Rejects unknown generated WASM glue]]
  it('fails when wasm-bindgen changes the loader shape', () => {
    expect(() => patchNodeGlue('unexpected generated output')).toThrow(
      'Could not find the wasm-bindgen Node loader',
    );
  });
});
