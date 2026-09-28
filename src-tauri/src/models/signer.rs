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
    pub signature_file: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CertificateSignerInput {
    pub name: String,
    pub role: String,
    pub professional_document: String,
    pub signature_file: String,
}

impl CertificateSignerInput {
    pub fn validated(self) -> AppResult<Self> {
        let value = Self { name: clean(&self.name, 200), role: clean(&self.role, 120), professional_document: clean(&self.professional_document, 60), signature_file: clean(&self.signature_file, 100) };
        if value.name.is_empty() || value.role.is_empty() || value.professional_document.is_empty() || value.signature_file.is_empty() {
            return Err(AppError::user("Nombre, cargo, documento profesional y firma son obligatorios."));
        }
        Ok(value)
    }
}
