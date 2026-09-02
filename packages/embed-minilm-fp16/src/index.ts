/**
 * all-MiniLM-L6-v2 weights (fp16) packaged as a model manifest for @lat.md/embed.
 * The engine up-casts the fp16 weights to fp32 at load, so output quality matches
 * fp32 while the download is ~half the size.
 */
import { fileURLToPath } from 'node:url';
import type { ModelManifest } from '@lat.md/embed';

const manifest: ModelManifest = {
  id: 'minilm-l6-v2',
  dimensions: 384,
  maxTokens: 256,
  pooling: 'mean',
  normalize: true,
  weightsPath: fileURLToPath(
    new URL('../model/model.fp16.safetensors', import.meta.url),
  ),
  tokenizerPath: fileURLToPath(
    new URL('../model/tokenizer.json', import.meta.url),
  ),
  configPath: fileURLToPath(new URL('../model/config.json', import.meta.url)),
};

export default manifest;
