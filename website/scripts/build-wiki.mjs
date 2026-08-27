import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(scriptDir, '..');
const projectRoot = resolve(websiteRoot, '..');
const publicDir = join(websiteRoot, 'public');
const destination = join(publicDir, 'lat.md');
const markerName = '.lat-ui-build';

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}

async function existingGeneratedWiki() {
  try {
    const marker = JSON.parse(
      await readFile(join(destination, markerName), 'utf8'),
    );
    return marker.version === 1;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

const packageManager = process.env.npm_execpath;
const pnpmCommand = packageManager
  ? { command: process.execPath, args: [packageManager] }
  : {
      command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: [],
    };

await run(
  pnpmCommand.command,
  [...pnpmCommand.args, '--dir', projectRoot, 'build'],
  projectRoot,
);

const scratch = await mkdtemp(join(tmpdir(), 'lat-website-wiki-'));
const output = join(scratch, 'output');
const stage = join(publicDir, `.lat.md-${process.pid}`);

try {
  await run(
    process.execPath,
    [
      join(projectRoot, 'dist/src/cli/index.js'),
      'ui',
      'build',
      output,
      '--base',
      '/lat.md/',
    ],
    projectRoot,
  );

  await cp(join(output, 'lat.md'), stage, { recursive: true });
  await writeFile(
    join(stage, markerName),
    `${JSON.stringify({ version: 1 })}\n`,
  );

  if (await pathExists(destination)) {
    if (!(await existingGeneratedWiki())) {
      throw new Error(`Refusing to replace unmanaged wiki at ${destination}`);
    }
    await rm(destination, { recursive: true });
  }
  await rename(stage, destination);
} finally {
  await rm(stage, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
}
