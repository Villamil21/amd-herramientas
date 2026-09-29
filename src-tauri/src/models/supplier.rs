use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;

/// "purchase" = Compras, "service" = Servicios.
pub const VAT_TYPES: &[&str] = &["purchase", "service"];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Supplier {
    pub id: i64,
    pub nit: String,
    pub business_name: String,
    pub vat_type: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupplierInput {
    pub nit: String,
    pub business_name: String,
    pub vat_type: String,
}

/// NIT solo con dígitos y sin dígito de verificación: "900.319.753-1" → "900319753".
pub fn normalize_nit(value: &str) -> String {
    let main = value.split('-').next().unwrap_or("");
    main.chars().filter(char::is_ascii_digit).collect()
}

impl SupplierInput {
    pub fn validated(self) -> AppResult<Self> {
        let v = SupplierInput {
            nit: normalize_nit(&self.nit),
            business_name: clean(&self.business_name, 250),
            vat_type: self.vat_type.trim().to_ascii_lowercase(),
        };
        if v.nit.is_empty() || v.nit.len() > 20 {
            return Err(AppError::user("Escribe un NIT válido (solo números, sin dígito de verificación)."));
        }
        if v.business_name.is_empty() {
            return Err(AppError::user("La razón social es obligatoria."));
        }
        if !VAT_TYPES.contains(&v.vat_type.as_str()) {
            return Err(AppError::user("Selecciona el tipo IVA (Compras o Servicios)."));
        }
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_nit() {
        assert_eq!(normalize_nit("900.319.753-1"), "900319753");
        assert_eq!(normalize_nit(" 900319753 "), "900319753");
    }

    #[test]
    fn validates_vat_type() {
        let ok = SupplierInput { nit: "900319753".into(), business_name: " A ".into(), vat_type: "Purchase".into() };
        assert_eq!(ok.validated().unwrap().vat_type, "purchase");
        let bad = SupplierInput { nit: "1".into(), business_name: "A".into(), vat_type: "otro".into() };
        assert!(bad.validated().is_err());
    }
}
