use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;
use crate::models::third_party::{self, ThirdPartyData};
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
    /// Datos tributarios para Información Exógena (el número de documento es `nit`). Ausentes en backups anteriores.
    #[serde(default)]
    pub doc_type_code: Option<String>,
    #[serde(default)]
    pub dv: String,
    #[serde(default)]
    pub first_surname: String,
    #[serde(default)]
    pub second_surname: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub other_names: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub country_code: String,
    #[serde(default)]
    pub country_name: String,
    #[serde(default)]
    pub dept_code: String,
    #[serde(default)]
    pub dept_name: String,
    #[serde(default)]
    pub muni_code: String,
    #[serde(default)]
    pub muni_name: String,
    /// De dónde salieron los datos: manual, factura, rut, empresas.
    #[serde(default)]
    pub data_origin: String,
    #[serde(default)]
    pub data_verified_at: Option<String>,
    /// «completo» / «requiere_datos»: lo calcula Rust al guardar.
    #[serde(default = "default_data_status")]
    pub data_status: String,
}

fn default_data_status() -> String {
    third_party::STATUS_MISSING.to_string()
}

impl Supplier {
    /// Datos tributarios del tercero (con el `person_type` de Retención en la fuente, que es el mismo dato).
    pub fn third_party(&self) -> ThirdPartyData {
        ThirdPartyData {
            doc_type_code: self.doc_type_code.clone(),
            dv: self.dv.clone(),
            person_type: self.person_type.clone(),
            first_surname: self.first_surname.clone(),
            second_surname: self.second_surname.clone(),
            first_name: self.first_name.clone(),
            other_names: self.other_names.clone(),
            address: self.address.clone(),
            country_code: self.country_code.clone(),
            country_name: self.country_name.clone(),
            dept_code: self.dept_code.clone(),
            dept_name: self.dept_name.clone(),
            muni_code: self.muni_code.clone(),
            muni_name: self.muni_name.clone(),
        }
    }
}

/// Datos tributarios que el usuario (o una factura / el RUT) aporta para un tercero.
#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SupplierTaxInput {
    pub data: ThirdPartyData,
    #[serde(default)]
    pub data_origin: String,
}

impl SupplierTaxInput {
    pub fn validated(self) -> AppResult<Self> {
        let origin = clean(&self.data_origin, 20).to_ascii_lowercase();
        if !["", "manual", "factura", "rut", "empresas"].contains(&origin.as_str()) {
            return Err(AppError::user("El origen de los datos no es válido."));
        }
        Ok(SupplierTaxInput { data: self.data.normalized()?.without_inapplicable_names(), data_origin: if origin.is_empty() { "manual".into() } else { origin } })
    }
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
        self.validated_for(None)
    }

    /// Igual que `validated`, pero el número respeta el tipo de documento: un pasaporte conserva sus letras.
    pub fn validated_for(self, doc_type: Option<&str>) -> AppResult<Self> {
        self.validated_with(doc_type, false)
    }

    /// Respaldo y restauración: la ficha mínima creada desde una planilla (SENA / ICBF) no tiene razón social todavía.
    pub fn validated_pending_name(self) -> AppResult<Self> {
        self.validated_with(None, true)
    }

    fn validated_with(self, doc_type: Option<&str>, allow_empty_name: bool) -> AppResult<Self> {
        let v = SupplierInput {
            nit: if third_party::allows_letters(doc_type) { third_party::document_number(&self.nit, doc_type) } else { normalize_nit(&self.nit) },
            business_name: clean(&self.business_name, 250),
            vat_type: self.vat_type.map(|t| t.trim().to_ascii_lowercase()).filter(|t| !t.is_empty()),
        };
        if v.nit.is_empty() || v.nit.len() > 20 {
            return Err(AppError::user("Escribe un NIT válido (solo números, sin dígito de verificación)."));
        }
        if v.business_name.is_empty() && !allow_empty_name {
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
