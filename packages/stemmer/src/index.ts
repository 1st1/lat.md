import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export const STEMMER_VERSION = 'snowball-english-rust-stemmers-1.2.0-v1';

interface Engine {
  __initialize(bytes: Uint8Array): void;
  stem_words(words: string[]): string[];
}
let engine: Engine | undefined;
function load(): Engine {
  if (engine) return engine;
  const require = createRequire(import.meta.url);
  const loaded = require('./engine.cjs') as Engine;
  loaded.__initialize(
    readFileSync(new URL('./engine_bg.wasm', import.meta.url)),
  );
  engine = loaded;
  return loaded;
}

/** Stem English words; callers supply token boundaries. Lowercases inputs. */
export function stemWords(words: readonly string[]): string[] {
  if (!words.length) return [];
  return load().stem_words(words.map((word) => word.toLowerCase()));
}

export function stem(word: string): string {
  return stemWords([word])[0];
}
