/**
 * Prepare the Rust/WASM toolchain used by this package.
 *
 * rust-toolchain.toml selects stable Rust and its WASM target. This script
 * verifies that rustup applied them and installs the matching wasm-bindgen CLI
 * into the package instead of relying on a machine-global executable.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  cargoToolsDir,
  pkgDir,
  wasmBindgenBin,
  wasmBindgenVersion,
  wasmTarget,
} from './rust-tools.mjs';

const run = (cmd, args, options = {}) => {
  try {
    return execFileSync(cmd, args, {
      cwd: pkgDir,
      encoding: 'utf8',
      stdio: options.capture ? 'pipe' : 'inherit',
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Could not run ${cmd}. Install Rust with rustup: https://rustup.rs/`,
      );
    }
    throw error;
  }
};

const targets = run('rustup', ['target', 'list', '--installed'], {
  capture: true,
});
if (!targets.split(/\r?\n/).includes(wasmTarget)) {
  run('rustup', ['target', 'add', wasmTarget]);
}

const wasmBindgenExists = existsSync(wasmBindgenBin);
let installedVersion = null;
if (wasmBindgenExists) {
  const output = run(wasmBindgenBin, ['--version'], { capture: true }).trim();
  installedVersion = output.match(/^wasm-bindgen (\S+)$/)?.[1] ?? null;
}

if (installedVersion !== wasmBindgenVersion) {
  console.log(
    `Installing wasm-bindgen-cli ${wasmBindgenVersion} into ${cargoToolsDir}`,
  );
  run('cargo', [
    'install',
    'wasm-bindgen-cli',
    '--version',
    `=${wasmBindgenVersion}`,
    '--locked',
    '--root',
    cargoToolsDir,
    ...(wasmBindgenExists ? ['--force'] : []),
  ]);
} else {
  console.log(`Using project-local wasm-bindgen-cli ${wasmBindgenVersion}`);
}
