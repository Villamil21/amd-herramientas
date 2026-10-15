use serde::{Deserialize, Serialize};

/// Código del catálogo PUC (oficial o personalizado).
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
    /// Inactivo: no se ofrece en nuevas selecciones; lo histórico lo conserva.
    pub active: bool,
    /// Denominación del catálogo cuando el usuario cambió la de una cuenta oficial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub official_concept: Option<String>,
}

/// Edición de una fila de la tabla. En una cuenta oficial solo cambia el
/// concepto (vacío = volver a la denominación oficial); en una personalizada
/// también el código (solo si no tiene uso) y el padre.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PucCodeUpdateInput {
    pub code: String,
    #[serde(default)]
    pub new_code: Option<String>,
    pub concept: String,
    #[serde(default)]
    pub parent_code: Option<String>,
}

/// Una clase de referencia a un código PUC (ej. 3 movimientos de compras).
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PucUsageItem {
    /// movements:<source> | reclassified | adjustments | opening_drafts | bank_balances | bank_accounts
    /// | bank_concepts | puc_settings | suppliers | snapshots | children
    pub kind: String,
    pub count: i64,
}

/// Referencias de un código: si hay alguna, no se puede eliminar ni cambiar su número.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PucUsage {
    pub code: String,
    pub total: i64,
    pub items: Vec<PucUsageItem>,
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
