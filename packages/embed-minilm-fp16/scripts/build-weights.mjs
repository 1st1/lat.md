/**
 * Fetch all-MiniLM-L6-v2 from HuggingFace and produce this package's model/ dir:
 *   - model.fp16.safetensors  (fp32 weights cast to fp16 — half the size, loaded
 *     back as fp32 by the engine, so quality is identical to fp32)
 *   - tokenizer.json, config.json  (copied verbatim)
 *
 * Run in CI before publish. Artifacts are not committed to git.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE =
  'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main';
const modelDir = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'model',
);
mkdirSync(modelDir, { recursive: true });

// Idempotent: skip the ~90 MB fetch + convert if artifacts already exist, so a
// plain `pnpm build` is fast on repeat runs. Set LAT_FORCE_WEIGHTS=1 to rebuild.
const artifacts = ['model.fp16.safetensors', 'tokenizer.json', 'config.json'];
if (
  !process.env.LAT_FORCE_WEIGHTS &&
  artifacts.every((f) => existsSync(join(modelDir, f)))
) {
  console.log(
    'weights already present, skipping (LAT_FORCE_WEIGHTS=1 to rebuild)',
  );
  process.exit(0);
}

const get = async (path, kind) => {
  const r = await fetch(`${BASE}/${path}`);
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  return kind === 'buf' ? Buffer.from(await r.arrayBuffer()) : await r.text();
};

// IEEE-754 float32 → float16 (round-to-nearest-even), returns a uint16.
function f32ToF16(v) {
  const f = new Float32Array(1);
  const i = new Int32Array(f.buffer);
  f[0] = v;
  const x = i[0];
  const sign = (x >>> 16) & 0x8000;
  let mant = x & 0x007fffff;
  let exp = (x >>> 23) & 0xff;
  if (exp === 255) return sign | (mant ? 0x7e00 : 0x7c00); // NaN/Inf
  exp = exp - 127 + 15;
  if (exp >= 31) return sign | 0x7c00; // overflow → Inf
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow → 0
    mant |= 0x00800000;
    const shift = 14 - exp;
    let half = mant >> shift;
    if ((mant >> (shift - 1)) & 1) half += 1; // round
    return sign | half;
  }
  let half = (exp << 10) | (mant >> 13);
  if (mant & 0x1000) half += 1; // round-to-nearest-even (approx)
  return sign | half;
}

function convertSafetensorsToF16(buf) {
  const headerLen = Number(buf.readBigUint64LE(0));
  const header = JSON.parse(buf.toString('utf8', 8, 8 + headerLen));
  const dataStart = 8 + headerLen;

  const outHeader = {};
  const chunks = [];
  let offset = 0;
  if (header.__metadata__) outHeader.__metadata__ = header.__metadata__;

  for (const [name, info] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    const [s, e] = info.data_offsets;
    const raw = buf.subarray(dataStart + s, dataStart + e);
    let outBytes, dtype;
    if (info.dtype === 'F32') {
      const n = raw.length / 4;
      outBytes = Buffer.alloc(n * 2);
      for (let k = 0; k < n; k++) {
        outBytes.writeUInt16LE(f32ToF16(raw.readFloatLE(k * 4)), k * 2);
      }
      dtype = 'F16';
    } else {
      outBytes = Buffer.from(raw); // pass through non-float tensors
      dtype = info.dtype;
    }
    outHeader[name] = {
      dtype,
      shape: info.shape,
      data_offsets: [offset, offset + outBytes.length],
    };
    offset += outBytes.length;
    chunks.push(outBytes);
  }

  const headerJson = Buffer.from(JSON.stringify(outHeader), 'utf8');
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUint64LE(BigInt(headerJson.length));
  return Buffer.concat([lenBuf, headerJson, ...chunks]);
}

console.log('fetching MiniLM weights + tokenizer…');
const [fp32, tokenizer, config] = await Promise.all([
  get('model.safetensors', 'buf'),
  get('tokenizer.json', 'text'),
  get('config.json', 'text'),
]);

console.log('converting fp32 → fp16…');
const fp16 = convertSafetensorsToF16(fp32);

writeFileSync(join(modelDir, 'model.fp16.safetensors'), fp16);
writeFileSync(join(modelDir, 'tokenizer.json'), tokenizer);
writeFileSync(join(modelDir, 'config.json'), config);
console.log(
  `wrote model/ (fp16 weights ${(fp16.length / 1e6).toFixed(1)} MB, was ${(fp32.length / 1e6).toFixed(1)} MB)`,
);
