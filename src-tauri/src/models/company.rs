use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub id: i64,
    pub razon_social: String,
    pub nit: String,
    pub direccion: String,
    pub ciudad: String,
    pub telefono: String,
    pub correo: String,
    pub info_adicional: String,
    pub logo_file: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanyInput {
    pub razon_social: String,
    pub nit: String,
    #[serde(default)]
    pub direccion: String,
    #[serde(default)]
    pub ciudad: String,
    #[serde(default)]
    pub telefono: String,
    #[serde(default)]
    pub correo: String,
    #[serde(default)]
    pub info_adicional: String,
    pub logo_file: Option<String>,
}

impl CompanyInput {
    /// Valida en Rust aunque React ya haya validado: el backend es la última barrera.
    pub fn validated(self) -> AppResult<Self> {
        let v = CompanyInput {
            razon_social: clean(&self.razon_social, 200),
            nit: clean(&self.nit, 30),
            direccion: clean(&self.direccion, 250),
            ciudad: clean(&self.ciudad, 100),
            telefono: clean(&self.telefono, 60),
            correo: clean(&self.correo, 150),
            info_adicional: clean(&self.info_adicional, 2000),
            logo_file: self.logo_file.filter(|s| !s.trim().is_empty()),
        };
        if v.razon_social.is_empty() {
            return Err(AppError::user("La razón social es obligatoria."));
        }
        if v.nit.is_empty() {
            return Err(AppError::user("El NIT es obligatorio."));
        }
        if !v.nit.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | ' ')) {
            return Err(AppError::user("El NIT solo puede contener números, puntos y guion."));
        }
        if !v.correo.is_empty() && !(v.correo.contains('@') && v.correo.contains('.')) {
            return Err(AppError::user("El correo electrónico no es válido."));
        }
        Ok(v)
    }
}
