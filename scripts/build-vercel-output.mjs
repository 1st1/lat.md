import { buildVercelOutput } from '../dist/src/view/vercel-build.js';

const result = await buildVercelOutput(
  process.argv[2] ?? '.lat-build/server',
  process.argv[3] ?? '.vercel/output',
  { force: true, warn: console.warn },
);
console.log(
  `Built ${result.files} traced files at ${result.outputDir} (${result.functionPath})`,
);
