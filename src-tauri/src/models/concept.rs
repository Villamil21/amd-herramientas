use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;

pub const TIPOS_RETENCION: &[&str] = &["RETEFUENTE", "ICA"];
pub const UNIDADES_TARIFA: &[&str] = &["PORCENTAJE", "POR_MIL"];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Concept {
    pub id: i64,
    pub nombre: String,
    pub tipo_retencion: String,
    pub tarifa_predeterminada: Option<f64>,
    pub unidad_tarifa: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConceptInput {
    pub nombre: String,
    pub tipo_retencion: String,
    pub tarifa_predeterminada: Option<f64>,
    pub unidad_tarifa: String,
}

impl ConceptInput {
    pub fn validated(self) -> AppResult<Self> {
        let v = ConceptInput {
            nombre: clean(&self.nombre, 250),
            tipo_retencion: self.tipo_retencion.trim().to_ascii_uppercase(),
            tarifa_predeterminada: self.tarifa_predeterminada,
            unidad_tarifa: self.unidad_tarifa.trim().to_ascii_uppercase(),
        };
        if v.nombre.is_empty() {
            return Err(AppError::user("El nombre del concepto es obligatorio."));
        }
        if !TIPOS_RETENCION.contains(&v.tipo_retencion.as_str()) {
            return Err(AppError::user("Selecciona un tipo de retención válido."));
        }
        if !UNIDADES_TARIFA.contains(&v.unidad_tarifa.as_str()) {
            return Err(AppError::user("Selecciona la unidad de la tarifa (% o ‰)."));
        }
        if let Some(t) = v.tarifa_predeterminada {
            if !t.is_finite() || t < 0.0 || t > 1000.0 {
                return Err(AppError::user("La tarifa predeterminada no es válida."));
            }
        }
        Ok(v)
    }
}
