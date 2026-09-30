use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::clean;

/// Tipo de documento de identidad del titular de un certificado de ingresos.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IdentityDocumentType {
    pub id: i64,
    pub name: String,
    /// El número se muestra con separador de miles (1.006.011.707).
    pub is_numeric: bool,
    /// Tipo inicial de la aplicación: no se puede eliminar.
    pub is_system: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IdentityDocumentTypeInput {
    pub name: String,
    pub is_numeric: bool,
}

impl IdentityDocumentTypeInput {
    pub fn validated(self) -> AppResult<Self> {
        let name = clean(&self.name, 80).split_whitespace().collect::<Vec<_>>().join(" ");
        if name.is_empty() {
            return Err(AppError::user("Escribe el nombre del tipo de documento."));
        }
        Ok(Self { name, is_numeric: self.is_numeric })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_and_requires_name() {
        let v = IdentityDocumentTypeInput { name: "  Permiso  por Protección   Temporal ".into(), is_numeric: false }.validated().unwrap();
        assert_eq!(v.name, "Permiso por Protección Temporal");
        assert!(IdentityDocumentTypeInput { name: "   ".into(), is_numeric: true }.validated().is_err());
    }
}
