/**
 * Copy the built WASM engine into dist/ next to the compiled TS.
 * The CJS glue is renamed engine.js → engine.cjs so it is treated as CommonJS
 * inside this `type: module` package; wasm-loader.ts loads it via createRequire.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
copyFileSync(glue, join(dist, 'engine.cjs'));
copyFileSync(wasm, join(dist, 'engine_bg.wasm'));
console.log('Copied WASM engine → dist/');
