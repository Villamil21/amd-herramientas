use serde::{Deserialize, Serialize};

/// Código del catálogo PUC. Tabla maestra de solo lectura.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PucCode {
    pub code: String,
    /// DENOMINACION del catálogo.
    pub concept: String,
}

/// Código PUC confirmado alguna vez para un proveedor (fila de `supplier_puc_codes`, para el backup).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SupplierPucCode {
    /// NIT del emisor: solo dígitos, sin dígito de verificación.
    pub supplier_nit: String,
    pub puc_code: String,
    pub usage_count: i64,
    pub created_at: String,
    pub last_used_at: String,
}
