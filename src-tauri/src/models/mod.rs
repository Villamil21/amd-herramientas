pub mod company;
pub mod concept;
pub mod signer;

/// Recorta y limita la longitud de un texto proveniente del frontend.
pub fn clean(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}
