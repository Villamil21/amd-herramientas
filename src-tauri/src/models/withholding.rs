//! Retención en la fuente: tabla de retenciones, UVT por año, reglas de cada
//! proveedor y clasificación de títulos de documento (Factura / Nota).

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;

/// "fees" = Honorarios, "services" = Servicios, "rentals" = Arrendamientos, "purchases" = Compras.
pub const RETENTION_TYPES: &[&str] = &["fees", "services", "rentals", "purchases"];
pub const BASE_MODES: &[&str] = &["invoice_subtotal", "manual"];
pub const PERSON_TYPES: &[&str] = &["PJ", "PN"];
pub const TITLE_CATEGORIES: &[&str] = &["invoice", "credit_note"];

/// Fila de la tabla de retenciones. La base mínima en pesos no se guarda: se
/// calcula con el valor UVT del año.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WithholdingRate {
    pub id: i64,
    pub retention_type: String,
    pub name: String,
    /// Centésimas de UVT: 10 UVT → 1000.
    pub base_uvt_centi: i64,
    /// Centésimas de punto: 4 % → 400.
    pub rate_bp: i64,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WithholdingRateInput {
    pub retention_type: String,
    pub name: String,
    pub base_uvt_centi: i64,
    pub rate_bp: i64,
}

impl WithholdingRateInput {
    pub fn validated(self) -> AppResult<Self> {
        let v = WithholdingRateInput {
            retention_type: self.retention_type.trim().to_ascii_lowercase(),
            name: clean(&self.name, 250),
            base_uvt_centi: self.base_uvt_centi,
            rate_bp: self.rate_bp,
        };
        if !RETENTION_TYPES.contains(&v.retention_type.as_str()) {
            return Err(AppError::user("Selecciona el tipo de retención (Honorarios, Servicios, Arrendamientos o Compras)."));
        }
        if v.name.is_empty() {
            return Err(AppError::user("El concepto es obligatorio."));
        }
        if !(0..=100_000_000).contains(&v.base_uvt_centi) {
            return Err(AppError::user("La base UVT debe ser un número mayor o igual a cero."));
        }
        if !(0..=10_000).contains(&v.rate_bp) {
            return Err(AppError::user("La tarifa debe estar entre 0 % y 100 %."));
        }
        Ok(v)
    }
}

/// Cambios de base UVT y tarifa de una fila existente.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WithholdingRateUpdate {
    pub id: i64,
    pub base_uvt_centi: i64,
    pub rate_bp: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UvtValue {
    pub year: i64,
    pub value_pesos: i64,
    pub updated_at: String,
}

pub fn validate_uvt(year: i64, value_pesos: i64) -> AppResult<()> {
    if !(2000..=2100).contains(&year) {
        return Err(AppError::user("Escribe un año válido (2000 a 2100)."));
    }
    if !(1..=100_000_000).contains(&value_pesos) {
        return Err(AppError::user("El valor UVT debe ser mayor que cero."));
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupplierWithholdingRule {
    pub id: i64,
    pub rate_id: i64,
    pub base_mode: String,
    pub is_default: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupplierWithholdingRuleInput {
    pub rate_id: i64,
    pub base_mode: String,
    pub is_default: bool,
}

/// Configuración de retención de un proveedor: PJ/PN y sus reglas (se reemplazan completas).
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WithholdingProfileInput {
    pub person_type: Option<String>,
    pub rules: Vec<SupplierWithholdingRuleInput>,
}

impl WithholdingProfileInput {
    pub fn validated(self) -> AppResult<Self> {
        let person_type = match self.person_type.as_deref().map(|p| p.trim().to_ascii_uppercase()) {
            None => None,
            Some(p) if p.is_empty() => None,
            Some(p) if PERSON_TYPES.contains(&p.as_str()) => Some(p),
            Some(_) => return Err(AppError::user("Selecciona PJ (persona jurídica) o PN (persona natural).")),
        };
        let mut rules = Vec::with_capacity(self.rules.len());
        for r in self.rules {
            let base_mode = r.base_mode.trim().to_ascii_lowercase();
            if !BASE_MODES.contains(&base_mode.as_str()) {
                return Err(AppError::user("Selecciona cómo se obtiene la base de cada regla."));
            }
            if rules.iter().any(|x: &SupplierWithholdingRuleInput| x.rate_id == r.rate_id) {
                return Err(AppError::user("El proveedor tiene el mismo subtipo de retención repetido."));
            }
            rules.push(SupplierWithholdingRuleInput { rate_id: r.rate_id, base_mode, is_default: r.is_default });
        }
        if rules.iter().filter(|r| r.is_default).count() > 1 {
            return Err(AppError::user("Solo una regla puede ser la predeterminada."));
        }
        // Con una sola regla, esa es la predeterminada.
        if rules.len() == 1 {
            rules[0].is_default = true;
        }
        Ok(WithholdingProfileInput { person_type, rules })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTitleMapping {
    pub id: i64,
    pub normalized_title: String,
    pub display_title: String,
    pub category: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTitleMappingInput {
    pub normalized_title: String,
    pub display_title: String,
    pub category: String,
}

pub fn validate_title_category(category: &str) -> AppResult<String> {
    let c = category.trim().to_ascii_lowercase();
    if TITLE_CATEGORIES.contains(&c.as_str()) {
        Ok(c)
    } else {
        Err(AppError::user("Selecciona si el título es Factura o Nota."))
    }
}

impl DocumentTitleMappingInput {
    pub fn validated(self) -> AppResult<Self> {
        let normalized_title = clean(&self.normalized_title, 250);
        if normalized_title.is_empty() {
            return Err(AppError::user("El título no puede estar vacío."));
        }
        let display_title = clean(&self.display_title, 250);
        Ok(DocumentTitleMappingInput {
            display_title: if display_title.is_empty() { normalized_title.clone() } else { display_title },
            normalized_title,
            category: validate_title_category(&self.category)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(rate_id: i64, is_default: bool) -> SupplierWithholdingRuleInput {
        SupplierWithholdingRuleInput { rate_id, base_mode: "invoice_subtotal".into(), is_default }
    }

    #[test]
    fn validates_profile() {
        let p = WithholdingProfileInput { person_type: Some(" pj ".into()), rules: vec![rule(6, false)] }.validated().unwrap();
        assert_eq!(p.person_type.as_deref(), Some("PJ"));
        assert!(p.rules[0].is_default, "una sola regla queda como predeterminada");
        assert!(WithholdingProfileInput { person_type: Some("X".into()), rules: vec![] }.validated().is_err());
        assert!(WithholdingProfileInput { person_type: None, rules: vec![rule(6, true), rule(13, true)] }.validated().is_err());
        assert!(WithholdingProfileInput { person_type: None, rules: vec![rule(6, false), rule(6, false)] }.validated().is_err());
        let two = WithholdingProfileInput { person_type: None, rules: vec![rule(6, false), rule(13, false)] }.validated().unwrap();
        assert!(two.rules.iter().all(|r| !r.is_default), "con varias reglas no se elige una arbitrariamente");
    }

    #[test]
    fn validates_rate_input() {
        let ok = WithholdingRateInput { retention_type: "Services".into(), name: " X ".into(), base_uvt_centi: 200, rate_bp: 400 };
        assert_eq!(ok.validated().unwrap().retention_type, "services");
        let bad = WithholdingRateInput { retention_type: "services".into(), name: "X".into(), base_uvt_centi: 0, rate_bp: 10_001 };
        assert!(bad.validated().is_err());
    }
}
