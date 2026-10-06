pub mod company;
pub mod concept;
pub mod dropi;
pub mod identity_document;
pub mod puc;
pub mod self_withholding;
pub mod signer;
pub mod supplier;
pub mod withholding;

/// Recorta y limita la longitud de un texto proveniente del frontend.
pub fn clean(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}
