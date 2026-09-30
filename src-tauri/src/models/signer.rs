use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CertificateSigner {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub professional_document: String,
    /// Identificación personal (ej. "CC 1.192.729.629"). Opcional.
    #[serde(default)]
    pub personal_document: String,
    pub signature_file: String,
    pub created_at: String,
    pub updated_at: String,
    /// Calculado al leer: el PNG existe en el almacenamiento de firmas. No se guarda en SQLite.
    #[serde(default)]
    pub signature_available: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CertificateSignerInput {
    pub name: String,
    pub role: String,
    pub professional_document: String,
    #[serde(default)]
    pub personal_document: String,
    pub signature_file: String,
}

impl CertificateSignerInput {
    pub fn validated(self) -> AppResult<Self> {
        let value = Self { name: clean(&self.name, 200), role: clean(&self.role, 120), professional_document: clean(&self.professional_document, 60), personal_document: clean(&self.personal_document, 60), signature_file: clean(&self.signature_file, 100) };
        if value.name.is_empty() || value.role.is_empty() || value.professional_document.is_empty() || value.signature_file.is_empty() {
            return Err(AppError::user("Nombre, cargo, documento profesional y firma son obligatorios."));
        }
        Ok(value)
    }
}
