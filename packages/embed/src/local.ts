/**
 * Local embedding backend: the candle → WASM MiniLM engine, driven by a
 * {@link ModelManifest} from a weights package such as `@lat.md/embed-minilm-fp16`.
 *
 * The WASM engine is single-threaded, so large jobs (a full index/reindex) are
 * parallelized across `worker_threads` — one engine instance per thread. Small
 * jobs (incremental indexing, a search query) run inline to avoid worker
 * startup + per-worker model-load overhead.
 */

import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { Embedder, ModelManifest } from './index.js';
import { loadWasmEngine, type WasmEngine } from './wasm-loader.js';

// Below this many texts, run inline: spinning up workers (each loads ~90 MB of
// weights) isn't worth it. At/above, fan out across threads.
const WORKER_THRESHOLD = 24;
// Each worker should embed at least this many texts to amortize its model load,
// so worker count scales down for smaller jobs instead of always using all CPUs.
const MIN_PER_WORKER = 8;
// Texts handed to a worker per message — small enough to balance the long tail
// of section lengths across workers and stream progress smoothly.
const DISPATCH = 8;

function makeEngine(model: ModelManifest): WasmEngine {
  const { Embedder: WasmEmbedder } = loadWasmEngine();
  return new WasmEmbedder(
    new Uint8Array(readFileSync(model.weightsPath)),
    new Uint8Array(readFileSync(model.tokenizerPath)),
    new Uint8Array(readFileSync(model.configPath)),
    model.maxTokens,
  );
}

/** Embed across `workerCount` threads; results assembled by index (deterministic). */
function embedParallel(
  model: ModelManifest,
  texts: string[],
  workerCount: number,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    const results: number[][] = new Array(texts.length);
    let done = 0;
    let next = 0;
    let settled = false;
    const workerUrl = new URL('./worker.js', import.meta.url);
    const workers: Worker[] = [];

    const cleanup = () => workers.forEach((w) => void w.terminate());
    const dispatch = (w: Worker): void => {
      if (next >= texts.length) return;
      const baseIndex = next;
      const slice = texts.slice(next, next + DISPATCH);
      next += slice.length;
      w.postMessage({ baseIndex, texts: slice });
    };

    for (let k = 0; k < workerCount; k++) {
      const w = new Worker(workerUrl, {
        workerData: {
          weightsPath: model.weightsPath,
          tokenizerPath: model.tokenizerPath,
          configPath: model.configPath,
          maxTokens: model.maxTokens,
        },
      });
      workers.push(w);
      w.on(
        'message',
        (msg: { ready?: true; baseIndex?: number; vectors?: number[][] }) => {
          if (msg.ready) {
            dispatch(w);
            return;
          }
          const { baseIndex, vectors } = msg as {
            baseIndex: number;
            vectors: number[][];
          };
          for (let i = 0; i < vectors.length; i++) {
            results[baseIndex + i] = vectors[i];
          }
          done += vectors.length;
          onProgress?.(done, texts.length);
          if (done >= texts.length) {
            if (!settled) {
              settled = true;
              cleanup();
              resolve(results);
            }
            return;
          }
          dispatch(w);
        },
      );
      w.on('error', (err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      });
    }
  });
}

export async function createLocalEmbedder(
  model: ModelManifest,
): Promise<Embedder> {
  // Dimensions come from the manifest, so the main-thread engine is created
  // lazily — a worker-parallelized job never loads the model on the main thread.
  let main: WasmEngine | null = null;
  const mainEngine = () => (main ??= makeEngine(model));

  return {
    name: `local:${model.id}`,
    dimensions: model.dimensions,
    embed: async (texts, onProgress) => {
      if (texts.length === 0) return [];

      const workerCount = Math.min(
        availableParallelism(),
        Math.ceil(texts.length / MIN_PER_WORKER),
      );
      if (texts.length >= WORKER_THRESHOLD && workerCount > 1) {
        return embedParallel(model, texts, workerCount, onProgress);
      }

      // Inline, one text per forward pass (no batch padding waste). Yield between
      // items so progress repaints and Ctrl-C is responsive.
      const engine = mainEngine();
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i++) {
        out.push(...engine.embed([texts[i]]));
        onProgress?.(i + 1, texts.length);
        if (i + 1 < texts.length) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      return out;
    },
  };
}
