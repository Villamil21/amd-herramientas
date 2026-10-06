use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;
use crate::models::withholding::SupplierWithholdingRule;

/// "purchase" = Compras, "service" = Servicios.
pub const VAT_TYPES: &[&str] = &["purchase", "service"];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Supplier {
    pub id: i64,
    pub nit: String,
    pub business_name: String,
    /// `None`: sin configurar (proveedor creado solo con NIT y razón social). IVA de compras lo pide cuando lo necesita.
    #[serde(default)]
    pub vat_type: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Retención en la fuente: "PJ" o "PN". Los campos siguientes faltan en backups anteriores.
    #[serde(default)]
    pub person_type: Option<String>,
    /// Régimen / responsabilidad fiscal del emisor leída de la última factura verificada.
    #[serde(default)]
    pub fiscal_regime: Option<String>,
    #[serde(default)]
    pub fiscal_checked_at: Option<String>,
    #[serde(default)]
    pub withholding_rules: Vec<SupplierWithholdingRule>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupplierInput {
    pub nit: String,
    pub business_name: String,
    /// Opcional: NIT y razón social son los datos mínimos de un proveedor.
    #[serde(default)]
    pub vat_type: Option<String>,
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
            vat_type: self.vat_type.map(|t| t.trim().to_ascii_lowercase()).filter(|t| !t.is_empty()),
        };
        if v.nit.is_empty() || v.nit.len() > 20 {
            return Err(AppError::user("Escribe un NIT válido (solo números, sin dígito de verificación)."));
        }
        if v.business_name.is_empty() {
            return Err(AppError::user("La razón social es obligatoria."));
        }
        if v.vat_type.as_deref().is_some_and(|t| !VAT_TYPES.contains(&t)) {
            return Err(AppError::user("El tipo IVA debe ser Compras o Servicios."));
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
        let ok = SupplierInput { nit: "900319753".into(), business_name: " A ".into(), vat_type: Some("Purchase".into()) };
        assert_eq!(ok.validated().unwrap().vat_type.as_deref(), Some("purchase"));
        // NIT y razón social bastan: el Tipo IVA puede quedar sin configurar, nunca se inventa.
        let minimal = SupplierInput { nit: "900.999.999-1".into(), business_name: "PROVEEDOR NUEVO SAS".into(), vat_type: Some(" ".into()) };
        let minimal = minimal.validated().unwrap();
        assert_eq!((minimal.nit.as_str(), minimal.vat_type), ("900999999", None));
        let bad = SupplierInput { nit: "1".into(), business_name: "A".into(), vat_type: Some("otro".into()) };
        assert!(bad.validated().is_err());
    }
}
