import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const crateDir = join(pkgDir, 'crate');
export const wasmTarget = 'wasm32-unknown-unknown';
export const cargoToolsDir = join(pkgDir, '.cargo-tools');
export const wasmBindgenBin = join(
  cargoToolsDir,
  'bin',
  process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen',
);

const lock = readFileSync(join(crateDir, 'Cargo.lock'), 'utf8');
const match = lock.match(
  /\[\[package\]\]\r?\nname = "wasm-bindgen"\r?\nversion = "([^"]+)"/,
);

if (!match) {
  throw new Error('Could not find the wasm-bindgen version in Cargo.lock');
}

export const wasmBindgenVersion = match[1];
