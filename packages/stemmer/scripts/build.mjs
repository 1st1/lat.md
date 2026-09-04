import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  wasmBindgenBin,
  wasmBindgenVersion,
} from '../../embed/scripts/rust-tools.mjs';

const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
const crate = join(pkg, 'crate');
const run = (cmd, args, cwd = pkg) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
run(process.execPath, ['../embed/scripts/setup-rust.mjs']);
const manifest = readFileSync(join(crate, 'Cargo.toml'), 'utf8');
if (!manifest.includes('wasm-bindgen = "=' + wasmBindgenVersion + '"'))
  throw new Error(
    'Stemmer wasm-bindgen must match the shared toolchain version',
  );
run(
  'cargo',
  ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown'],
  crate,
);
const out = join(pkg, 'wasm-dist');
run(wasmBindgenBin, [
  join(crate, 'target/wasm32-unknown-unknown/release/lat_stemmer.wasm'),
  '--target',
  'nodejs',
  '--out-dir',
  out,
  '--out-name',
  'engine',
]);
const dist = join(pkg, 'dist');
mkdirSync(dist, { recursive: true });
const glue = readFileSync(join(out, 'engine.js'), 'utf8');
const marker = 'const wasmPath =';
const start = glue.lastIndexOf(marker);
if (start < 0) throw new Error('Unknown wasm-bindgen loader');
writeFileSync(
  join(dist, 'engine.cjs'),
  glue.slice(0, start) +
    `let wasm;
exports.__initialize = function(bytes) {
  wasm = new WebAssembly.Instance(new WebAssembly.Module(bytes), __wbg_get_imports()).exports;
  wasm.__wbindgen_start?.();
};
`,
);
copyFileSync(join(out, 'engine_bg.wasm'), join(dist, 'engine_bg.wasm'));
