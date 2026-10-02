//! Retención en la fuente ventas: Tabla de Autorretenciones (código CIIU →
//! tarifa) y clasificación de «Tipo de documento» de la hoja Ventas.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;

pub const SALES_CATEGORIES: &[&str] = &["invoice", "credit_note"];

/// Clave de comparación de un código CIIU: solo dígitos y, si tiene 4 o menos,
/// completado a 4 posiciones con ceros a la izquierda ("111" y "0111" → "0111").
/// Debe coincidir con `normalizeCiiu` del frontend.
pub fn normalize_ciiu(code: &str) -> String {
    let digits: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() && digits.len() < 4 {
        format!("{digits:0>4}")
    } else {
        digits
    }
}

/// Valida un código CIIU escrito por el usuario. Vacío = sin configurar.
pub fn validate_ciiu(code: &str) -> AppResult<String> {
    let v = clean(code, 10);
    if !v.is_empty() && (!v.chars().all(|c| c.is_ascii_digit()) || v.len() > 6) {
        return Err(AppError::user("El Código CIIU solo puede contener números (ej. 6201 o 0111)."));
    }
    Ok(v)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelfWithholdingRate {
    pub id: i64,
    /// Código tal como lo trae la fuente o lo escribió el usuario.
    pub ciiu_code: String,
    pub normalized_code: String,
    pub economic_activity: String,
    /// Centésimas de punto: 1,10 % → 110.
    pub rate_bp: i64,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelfWithholdingRateInput {
    pub ciiu_code: String,
    #[serde(default)]
    pub economic_activity: String,
    pub rate_bp: i64,
}

fn validate_rate_bp(rate_bp: i64) -> AppResult<()> {
    if !(0..=10_000).contains(&rate_bp) {
        return Err(AppError::user("La tarifa debe estar entre 0 % y 100 %."));
    }
    Ok(())
}

impl SelfWithholdingRateInput {
    pub fn validated(self) -> AppResult<Self> {
        let ciiu_code = validate_ciiu(&self.ciiu_code)?;
        if ciiu_code.is_empty() {
            return Err(AppError::user("Escribe el Código CIIU."));
        }
        validate_rate_bp(self.rate_bp)?;
        Ok(SelfWithholdingRateInput { ciiu_code, economic_activity: clean(&self.economic_activity, 300), rate_bp: self.rate_bp })
    }
}

/// Cambio de tarifa de una fila existente.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelfWithholdingRateUpdate {
    pub id: i64,
    pub rate_bp: i64,
}

impl SelfWithholdingRateUpdate {
    pub fn validate(&self) -> AppResult<()> {
        validate_rate_bp(self.rate_bp)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SalesDocumentTypeMapping {
    pub id: i64,
    pub normalized_label: String,
    pub original_label: String,
    pub category: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SalesDocumentTypeMappingInput {
    pub normalized_label: String,
    pub original_label: String,
    pub category: String,
}

pub fn validate_sales_category(category: &str) -> AppResult<String> {
    let c = category.trim().to_ascii_lowercase();
    if SALES_CATEGORIES.contains(&c.as_str()) {
        Ok(c)
    } else {
        Err(AppError::user("Selecciona si el tipo de documento es Facturas o Notas Crédito."))
    }
}

impl SalesDocumentTypeMappingInput {
    pub fn validated(self) -> AppResult<Self> {
        let normalized_label = clean(&self.normalized_label, 250);
        if normalized_label.is_empty() {
            return Err(AppError::user("El tipo de documento no puede estar vacío."));
        }
        let original_label = clean(&self.original_label, 250);
        Ok(SalesDocumentTypeMappingInput {
            original_label: if original_label.is_empty() { normalized_label.clone() } else { original_label },
            normalized_label,
            category: validate_sales_category(&self.category)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_ciiu_codes() {
        assert_eq!(normalize_ciiu("111"), "0111");
        assert_eq!(normalize_ciiu("0111"), "0111");
        assert_eq!(normalize_ciiu(" 62.01 "), "6201");
        assert_eq!(normalize_ciiu("10"), "0010");
        assert_eq!(normalize_ciiu("12345"), "12345", "otras longitudes no se recortan ni se rellenan");
        assert_eq!(normalize_ciiu(""), "");
    }

    #[test]
    fn validates_inputs() {
        assert_eq!(validate_ciiu(" 0111 ").unwrap(), "0111");
        assert_eq!(validate_ciiu("").unwrap(), "");
        assert!(validate_ciiu("62A1").is_err());
        assert!(validate_ciiu("1234567").is_err());
        assert!(SelfWithholdingRateInput { ciiu_code: "".into(), economic_activity: "".into(), rate_bp: 110 }.validated().is_err());
        assert!(SelfWithholdingRateInput { ciiu_code: "6201".into(), economic_activity: "".into(), rate_bp: 10_001 }.validated().is_err());
        let m = SalesDocumentTypeMappingInput { normalized_label: "documento x".into(), original_label: "".into(), category: " Invoice ".into() };
        let v = m.validated().unwrap();
        assert_eq!((v.original_label.as_str(), v.category.as_str()), ("documento x", "invoice"));
        assert!(SalesDocumentTypeMappingInput { normalized_label: "x".into(), original_label: "X".into(), category: "otro".into() }.validated().is_err());
    }
}
