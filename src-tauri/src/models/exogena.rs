use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::clean;

pub const STATUSES: [&str; 4] = ["en_preparacion", "listo", "requiere_actualizacion", "no_aplica"];
pub const ORIGINS: [&str; 3] = ["empresas", "estados_financieros", "manual"];
pub const CATALOGS: [&str; 4] = ["document_types", "countries", "departments", "municipalities"];

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentType {
    pub code: String,
    pub description: String,
    pub is_system: bool,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Country {
    pub code: String,
    pub name: String,
    pub is_system: bool,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Department {
    pub code: String,
    pub name: String,
    pub is_system: bool,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Municipality {
    pub dept_code: String,
    pub code: String,
    pub name: String,
    pub is_system: bool,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExoCatalogs {
    pub version: String,
    pub source: String,
    pub document_types: Vec<DocumentType>,
    pub countries: Vec<Country>,
    pub departments: Vec<Department>,
    pub municipalities: Vec<Municipality>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAuditEntry {
    pub id: i64,
    pub catalog: String,
    pub code: String,
    pub action: String,
    pub old_value: String,
    pub new_value: String,
    pub changed_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntryInput {
    pub catalog: String,
    pub code: String,
    /// Departamento del municipio (solo `municipalities`).
    #[serde(default)]
    pub parent_code: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

fn default_true() -> bool {
    true
}

impl CatalogEntryInput {
    pub fn validated(self) -> AppResult<Self> {
        if !CATALOGS.contains(&self.catalog.as_str()) {
            return Err(AppError::user("El catálogo no existe."));
        }
        let width = match self.catalog.as_str() {
            "document_types" | "departments" => 2,
            _ => 3,
        };
        let code = self.code.trim().to_string();
        if code.len() != width || !code.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::user(format!("El código debe tener {width} dígitos (se conservan los ceros iniciales).")));
        }
        let name = clean(&self.name, 200);
        if name.is_empty() {
            return Err(AppError::user("El nombre es obligatorio."));
        }
        let parent_code = self.parent_code.trim().to_string();
        if self.catalog == "municipalities" && (parent_code.len() != 2 || !parent_code.chars().all(|c| c.is_ascii_digit())) {
            return Err(AppError::user("El municipio necesita su departamento (código de 2 dígitos)."));
        }
        let parent_code = if self.catalog == "municipalities" { parent_code } else { String::new() };
        Ok(CatalogEntryInput { catalog: self.catalog, code, parent_code, name, is_active: self.is_active })
    }
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FormatStatusRow {
    pub format_code: String,
    pub status: String,
    pub not_applicable_reason: String,
    pub last_synced_at: Option<String>,
    pub source_fingerprint: String,
    pub updated_at: String,
    /// Registros reales del formato (sin encabezados ni filas decorativas).
    pub record_count: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExoRecord {
    pub id: i64,
    pub company_id: i64,
    pub year: i64,
    pub format_code: String,
    pub source_key: String,
    pub origin: String,
    pub origin_ref: String,
    pub data: Value,
    pub manual_fields: Vec<String>,
    pub manually_modified_at: Option<String>,
    pub synced_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncProposal {
    pub source_key: String,
    pub origin: String,
    #[serde(default)]
    pub origin_ref: String,
    pub data: Value,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApplySyncInput {
    pub company_id: i64,
    pub year: i64,
    pub format_code: String,
    /// Qué fuentes se leyeron («empresas», «estados_financieros: compras, tributarias, nómina»…).
    #[serde(default)]
    pub source: String,
    pub proposals: Vec<SyncProposal>,
    /// Retira los registros sincronizados cuya fuente ya no los propone (los corregidos a mano se conservan y se avisan).
    #[serde(default)]
    pub remove_missing: bool,
    /// Huella de los datos de origen en el momento de leerlos (ver `source_fingerprint`).
    #[serde(default)]
    pub source_fingerprint: Option<String>,
    /// Registros corregidos a mano que el usuario confirmó volver a los valores de la fuente.
    #[serde(default)]
    pub overwrite_manual: Vec<String>,
    /// Datos libres para la bitácora (pendientes de terceros, fuentes vacías…).
    #[serde(default)]
    pub summary: Value,
}

impl ApplySyncInput {
    pub fn validated(self) -> AppResult<Self> {
        if self.format_code.is_empty() || !self.format_code.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::user("El formato no es válido."));
        }
        if !(2000..=2100).contains(&self.year) {
            return Err(AppError::user("El año a informar no es válido."));
        }
        let mut seen = std::collections::HashSet::new();
        for p in &self.proposals {
            if p.source_key.trim().is_empty() || !seen.insert(p.source_key.clone()) {
                return Err(AppError::user("La sincronización trae un registro sin clave de origen o repetido."));
            }
            if !ORIGINS.contains(&p.origin.as_str()) || p.origin == "manual" {
                return Err(AppError::user("El origen de un registro sincronizado no es válido."));
            }
            if !p.data.is_object() {
                return Err(AppError::user("Los datos de un registro deben ser un objeto."));
            }
        }
        Ok(self)
    }
}

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub source_key: String,
    /// Campos corregidos a mano cuyo valor difiere del que propone la fuente.
    pub fields: Vec<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub created: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub removed: usize,
    pub conflicts: Vec<SyncConflict>,
    /// Registros que la fuente ya no propone pero tienen correcciones manuales: se conservaron.
    pub kept_manual_orphans: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncRun {
    pub id: i64,
    pub format_code: String,
    pub source: String,
    pub ran_at: String,
    pub summary: Value,
}
