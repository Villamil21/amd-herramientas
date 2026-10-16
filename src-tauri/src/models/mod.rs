pub mod company;
pub mod concept;
pub mod dropi;
pub mod exogena;
pub mod fs;
pub mod identity_document;
pub mod minimum_wage;
pub mod normalize;
pub mod puc;
pub mod self_withholding;
pub mod signer;
pub mod supplier;
pub mod third_party;
pub mod tax;
pub mod withholding;

/// Recorta y limita la longitud de un texto proveniente del frontend.
pub fn clean(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}
