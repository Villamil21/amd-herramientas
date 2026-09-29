use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;

/// "in_process" = En proceso, "claim" = Siniestro.
pub const CATEGORIES: &[&str] = &["in_process", "claim"];

/// Estados con regla fija, ya normalizados como en el frontend (sin tildes,
/// mayúsculas, "_" como espacio). Nunca se guardan como regla configurable.
const FIXED_STATUSES: &[&str] = &[
    "ENTREGADO",
    "CANCELADO",
    "RECHAZADO",
    "GUIA ANULADA",
    "DEVOLUCION",
    "INDEMNIZADA",
    "EN PROCESO DE INDEMNIZACION",
    "EN PROCESO INDEMNIZACION",
];

/// Clasificación guardada de un estado de Dropi (global al módulo).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DropiStatusMapping {
    pub id: i64,
    pub normalized_status: String,
    pub display_status: String,
    pub category: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DropiStatusMappingInput {
    pub normalized_status: String,
    pub display_status: String,
    pub category: String,
}

pub fn validate_category(category: &str) -> AppResult<String> {
    let c = category.trim().to_ascii_lowercase();
    if CATEGORIES.contains(&c.as_str()) {
        Ok(c)
    } else {
        Err(AppError::user("Selecciona la clasificación del estado (En proceso o Siniestro)."))
    }
}

impl DropiStatusMappingInput {
    pub fn validated(self) -> AppResult<Self> {
        let v = DropiStatusMappingInput {
            normalized_status: clean(&self.normalized_status, 200),
            display_status: clean(&self.display_status, 200),
            category: validate_category(&self.category)?,
        };
        if v.normalized_status.is_empty() {
            return Err(AppError::user("El estado no puede estar vacío."));
        }
        if FIXED_STATUSES.contains(&v.normalized_status.as_str()) {
            return Err(AppError::user(format!(
                "«{}» tiene una regla fija y no se puede reclasificar.",
                v.display_status
            )));
        }
        let display_status = if v.display_status.is_empty() { v.normalized_status.clone() } else { v.display_status };
        Ok(DropiStatusMappingInput { display_status, ..v })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(status: &str, category: &str) -> DropiStatusMappingInput {
        DropiStatusMappingInput { normalized_status: status.into(), display_status: status.into(), category: category.into() }
    }

    #[test]
    fn validates_category_and_fixed_statuses() {
        assert_eq!(input("EN REPARTO", " Claim ").validated().unwrap().category, "claim");
        assert!(input("EN REPARTO", "otro").validated().is_err());
        assert!(input("  ", "claim").validated().is_err());
        assert!(input("ENTREGADO", "in_process").validated().is_err());
        assert!(input("GUIA ANULADA", "in_process").validated().is_err());
    }
}
