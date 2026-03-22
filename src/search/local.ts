interface Extractor {
  (
    texts: string[],
    opts: { pooling: string; normalize: boolean },
  ): Promise<{ tolist(): number[][] }>;
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
        'Install with: pnpm install @huggingface/transformers\n' +
        '(It is an optional dependency — your package manager may have skipped it.)\n' +
        'Or set LAT_LLM_KEY to use an API provider instead.',
    );
  }
}

async function loadPipeline(model: string): Promise<Extractor> {
  const { pipeline } = await requireTransformers();
  return pipeline('feature-extraction', model, {
    dtype: 'fp16',
  }) as unknown as Extractor;
}

function getLocalPipeline(model: string): Promise<Extractor> {
  if (_pipeline && _pipelineModel === model) return _pipeline;
  _pipelineModel = model;
  _pipeline = loadPipeline(model).catch((err) => {
    _pipeline = null;
    _pipelineModel = null;
    throw err;
  });
  return _pipeline;
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
