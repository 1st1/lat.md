/**
 * Copy the built WASM engine into dist/ next to the compiled TS.
 * The CJS glue is renamed engine.js → engine.cjs so it is treated as CommonJS
 * inside this `type: module` package. Its self-loading footer is replaced so
 * wasm-loader.ts can initialize it from an analyzable module-relative URL.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchNodeGlue } from './patch-node-glue.mjs';

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(pkgDir, 'wasm-dist');
const dist = join(pkgDir, 'dist');

const glue = join(src, 'engine.js');
const wasm = join(src, 'engine_bg.wasm');
if (!existsSync(glue) || !existsSync(wasm)) {
  throw new Error(
    `Missing WASM artifacts in ${src}. Run \`pnpm build:wasm\` first (needs Rust + wasm-bindgen).`,
  );
}

mkdirSync(dist, { recursive: true });
writeFileSync(
  join(dist, 'engine.cjs'),
  patchNodeGlue(readFileSync(glue, 'utf8')),
);
copyFileSync(wasm, join(dist, 'engine_bg.wasm'));
console.log('Copied WASM engine → dist/');
