/**
 * all-MiniLM-L6-v2 weights (fp16) packaged as a model manifest for @lat.md/embed.
 * The engine up-casts the fp16 weights to fp32 at load, so output quality matches
 * fp32 while the download is ~half the size.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelManifest } from '@lat.md/embed';

const modelDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'model');

const manifest: ModelManifest = {
  id: 'minilm-l6-v2',
  dimensions: 384,
  maxTokens: 256,
  pooling: 'mean',
  normalize: true,
  weightsPath: join(modelDir, 'model.fp16.safetensors'),
  tokenizerPath: join(modelDir, 'tokenizer.json'),
  configPath: join(modelDir, 'config.json'),
};

export default manifest;
