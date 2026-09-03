import { describe, expect, it } from 'vitest';
// @ts-expect-error Build helpers are plain JavaScript so they can run before TypeScript compilation.
import { patchNodeGlue } from '../packages/embed/scripts/patch-node-glue.mjs';

const generatedLoader = `const wasmPath = \`${'${__dirname}'}/engine_bg.wasm\`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();`;

describe('embedding runtime assets', () => {
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
