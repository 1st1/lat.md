type ModelConfig = { hidden_size?: number; n_embd?: number; d_model?: number };

interface Extractor {
  (
    texts: string[],
    opts: { pooling: string; normalize: boolean },
  ): Promise<{ tolist(): number[][] }>;
  model?: { config?: ModelConfig };
}

const LOCAL_BATCH = 32;

let _pipeline: Promise<Extractor> | null = null;
let _pipelineModel: string | null = null;

async function requireTransformers() {
  try {
    return await import('@huggingface/transformers');
  } catch {
    throw new Error(
      'Local embeddings require the @huggingface/transformers package.\n' +
        'Install with: npm install @huggingface/transformers\n' +
        'Or set LAT_LLM_KEY to use an API provider instead.',
    );
  }
}

async function loadPipeline(model: string): Promise<Extractor> {
  const { pipeline } = await requireTransformers();
  // Single cast at the library boundary — Extractor captures the subset
  // of the HuggingFace pipeline shape we actually use.
  return pipeline('feature-extraction', model, {
    dtype: 'fp16',
  }) as unknown as Extractor;
}

function getLocalPipeline(model: string): Promise<Extractor> {
  if (_pipeline && _pipelineModel === model) return _pipeline;
  if (!_pipeline) {
    process.stderr.write(
      'Loading local embedding model (first run downloads ~45 MB)...\n',
    );
  }
  _pipelineModel = model;
  _pipeline = loadPipeline(model);
  return _pipeline;
}

export async function getLocalDimensions(model: string): Promise<number> {
  const extractor = await getLocalPipeline(model);
  const c = extractor.model?.config;
  const dim = c?.hidden_size ?? c?.n_embd ?? c?.d_model;
  if (typeof dim !== 'number') {
    throw new Error(
      `Cannot determine embedding dimensions for model '${model}': ` +
        `config has no hidden_size, n_embd, or d_model field.`,
    );
  }
  return dim;
}

export async function embedLocal(
  texts: string[],
  model: string,
): Promise<number[][]> {
  const extractor = await getLocalPipeline(model);
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += LOCAL_BATCH) {
    const batch = texts.slice(i, i + LOCAL_BATCH);
    const output = await extractor(batch, {
      pooling: 'mean',
      normalize: true,
    });
    results.push(...output.tolist());
  }
  return results;
}
