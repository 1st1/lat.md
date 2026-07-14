/**
 * Worker-thread entry for parallel local embedding. Each worker instantiates
 * its own WASM engine (the engine is single-threaded, so parallelism comes from
 * running N of them across threads) and embeds the text slices it's handed.
 *
 * Model files are passed as paths via workerData and read here, so the ~45 MB
 * weights are never copied through the message channel.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const enginePath = join(dirname(fileURLToPath(import.meta.url)), 'engine.cjs');
const { Embedder } = require(enginePath) as {
  Embedder: new (
    w: Uint8Array,
    t: Uint8Array,
    c: Uint8Array,
    maxTokens: number,
  ) => { embed(texts: string[]): number[][] };
};

const { weightsPath, tokenizerPath, configPath, maxTokens } = workerData as {
  weightsPath: string;
  tokenizerPath: string;
  configPath: string;
  maxTokens: number;
};

const engine = new Embedder(
  new Uint8Array(readFileSync(weightsPath)),
  new Uint8Array(readFileSync(tokenizerPath)),
  new Uint8Array(readFileSync(configPath)),
  maxTokens,
);

const port = parentPort!;
port.on('message', (msg: { baseIndex: number; texts: string[] }) => {
  // One text per forward pass — no batch padding waste (see local.ts).
  const vectors = msg.texts.map((t) => engine.embed([t])[0]);
  port.postMessage({ baseIndex: msg.baseIndex, vectors });
});
port.postMessage({ ready: true });
