use serde::Serialize;

/// Código del catálogo PUC. Tabla maestra de solo lectura.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PucCode {
    pub code: String,
    /// DENOMINACION del catálogo.
    pub concept: String,
}
