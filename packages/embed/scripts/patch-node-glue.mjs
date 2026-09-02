import { readFile, writeFile } from 'node:fs/promises';

const generatedLoader = `const wasmPath = \`\${__dirname}/engine_bg.wasm\`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();`;

const injectedLoader = `let wasm;
exports.__initialize = function(wasmBytes) {
    const wasmModule = new WebAssembly.Module(wasmBytes);
    const wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
    wasm = wasmInstance.exports;
    wasm.__wbindgen_start();
};`;

export function patchNodeGlue(source) {
  if (source.includes(injectedLoader)) return source;
  if (!source.includes(generatedLoader)) {
    throw new Error('Could not find the wasm-bindgen Node loader');
  }
  return source.replace(generatedLoader, injectedLoader);
}

export async function patchNodeGlueFile(path) {
  const source = await readFile(path, 'utf8');
  await writeFile(path, patchNodeGlue(source));
}
