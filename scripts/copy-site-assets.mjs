import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Website-owned files are not part of the general-purpose Lat exporter.
const publicDir = resolve(process.argv[2] ?? '.lat-build/server/public');
await copyFile(
  new URL('../llms.txt', import.meta.url),
  resolve(publicDir, 'llms.txt'),
);
