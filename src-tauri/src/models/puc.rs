use serde::{Deserialize, Serialize};

/// Código del catálogo PUC. Tabla maestra de solo lectura.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PucCode {
    pub code: String,
    /// DENOMINACION del catálogo (o la escrita por el usuario si es personalizado).
    pub concept: String,
    /// Creado en la app (global para todas las empresas). Puede tener más de 6 dígitos.
    #[serde(default)]
    pub custom: bool,
    /// Código padre confirmado por el usuario (solo personalizados).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_code: Option<String>,
}

/// Código PUC personalizado escrito por el usuario.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomPucCodeInput {
    pub code: String,
    pub concept: String,
    pub parent_code: String,
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
