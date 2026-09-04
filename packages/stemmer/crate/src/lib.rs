use rust_stemmers::{Algorithm, Stemmer};
use wasm_bindgen::prelude::*;

/// English only: a fixed algorithm lets the linker discard other languages.
#[wasm_bindgen]
pub fn stem_words(words: Vec<String>) -> Vec<String> {
    let stemmer = Stemmer::create(Algorithm::English);
    words.iter().map(|word| stemmer.stem(word).into_owned()).collect()
}
