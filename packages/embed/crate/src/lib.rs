//! candle-based MiniLM/BERT sentence-embedding engine, compiled to WebAssembly.
//!
//! Weights are loaded as an fp16 safetensors buffer and up-cast to fp32 at load;
//! the forward pass runs in fp32 (candle's CPU/wasm backend does not support a
//! pure-fp16 forward pass). Pooling is attention-mask-weighted mean followed by
//! L2 normalization — matching `sentence-transformers` (candle issue #380). The
//! naive `sum/n_tokens` pooling from candle's example is wrong for padded batches.

use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use tokenizers::{PaddingParams, PaddingStrategy, Tokenizer, TruncationParams};
use wasm_bindgen::prelude::*;

const DTYPE: DType = DType::F32;

#[wasm_bindgen]
pub struct Embedder {
    bert: BertModel,
    tokenizer: Tokenizer,
    dimensions: usize,
}

#[wasm_bindgen]
impl Embedder {
    /// Construct from raw model files. `weights` is an fp16 (or fp32) safetensors
    /// buffer; `tokenizer` is the bytes of `tokenizer.json`; `config` is the bytes
    /// of the BERT `config.json`. Inputs longer than `max_tokens` are truncated.
    #[wasm_bindgen(constructor)]
    pub fn new(
        weights: Vec<u8>,
        tokenizer: Vec<u8>,
        config: Vec<u8>,
        max_tokens: usize,
    ) -> Result<Embedder, JsError> {
        console_error_panic_hook::set_once();
        let device = &Device::Cpu;

        // fp16 file up-casts to fp32 here; compute stays fp32.
        let vb = VarBuilder::from_buffered_safetensors(weights, DTYPE, device)?;
        let config: Config = serde_json::from_slice(&config)?;
        let dimensions = config.hidden_size;
        let bert = BertModel::load(vb, &config)?;

        let mut tokenizer =
            Tokenizer::from_bytes(&tokenizer).map_err(|e| JsError::new(&e.to_string()))?;
        tokenizer
            .with_padding(Some(PaddingParams {
                strategy: PaddingStrategy::BatchLongest,
                ..Default::default()
            }))
            .with_truncation(Some(TruncationParams {
                max_length: max_tokens,
                ..Default::default()
            }))
            .map_err(|e| JsError::new(&e.to_string()))?;

        Ok(Self {
            bert,
            tokenizer,
            dimensions,
        })
    }

    /// Embed a batch of strings. `input` is a JS `string[]`; returns `number[][]`
    /// (one 384-dim L2-normalized vector per input).
    pub fn embed(&self, input: JsValue) -> Result<JsValue, JsError> {
        let texts: Vec<String> = serde_wasm_bindgen::from_value(input)
            .map_err(|e| JsError::new(&e.to_string()))?;
        if texts.is_empty() {
            return Ok(serde_wasm_bindgen::to_value(&Vec::<Vec<f32>>::new())?);
        }
        let device = &Device::Cpu;

        let encodings = self
            .tokenizer
            .encode_batch(texts, true)
            .map_err(|e| JsError::new(&e.to_string()))?;

        let mut ids = Vec::with_capacity(encodings.len());
        let mut masks = Vec::with_capacity(encodings.len());
        for enc in &encodings {
            ids.push(Tensor::new(enc.get_ids(), device)?);
            masks.push(Tensor::new(enc.get_attention_mask(), device)?);
        }
        let token_ids = Tensor::stack(&ids, 0)?; // [n, seq]
        let attention_mask = Tensor::stack(&masks, 0)?; // [n, seq]
        let token_type_ids = token_ids.zeros_like()?;

        let hidden = self
            .bert
            .forward(&token_ids, &token_type_ids, Some(&attention_mask))?; // [n, seq, h]

        // Attention-mask-weighted mean pooling.
        let mask = attention_mask.to_dtype(DTYPE)?.unsqueeze(2)?; // [n, seq, 1]
        let summed = hidden.broadcast_mul(&mask)?.sum(1)?; // [n, h]
        let counts = mask.sum(1)?; // [n, 1] real-token counts
        let mean = summed.broadcast_div(&counts)?; // [n, h]

        // L2 normalize.
        let norm = mean.sqr()?.sum_keepdim(1)?.sqrt()?;
        let normalized = mean.broadcast_div(&norm)?;

        let vectors: Vec<Vec<f32>> = normalized.to_vec2()?;
        Ok(serde_wasm_bindgen::to_value(&vectors)?)
    }

    /// Embedding dimensionality (e.g. 384 for MiniLM-L6).
    pub fn dimensions(&self) -> usize {
        self.dimensions
    }
}
