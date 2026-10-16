use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::files::sanitize_with_extension;
use crate::commands::to_path;
use crate::database::{exogena, Db};
use crate::error::{AppError, AppResult};
use crate::models::exogena::*;
use crate::services::{exogena_xlsx, logos};
use crate::state::AppState;

#[tauri::command]
pub fn get_exo_catalogs(db: State<'_, Db>) -> AppResult<ExoCatalogs> {
    db.with(|c| exogena::list_catalogs(c))
}

#[tauri::command]
pub fn save_exo_catalog_entry(db: State<'_, Db>, input: CatalogEntryInput) -> AppResult<()> {
    let input = input.validated()?;
    db.with(|c| exogena::save_catalog_entry(c, &input))
}

#[tauri::command]
pub fn delete_exo_catalog_entry(db: State<'_, Db>, catalog: String, code: String, parent_code: Option<String>) -> AppResult<()> {
    db.with(|c| exogena::delete_catalog_entry(c, &catalog, &code, parent_code.as_deref().unwrap_or("")))
}

#[tauri::command]
pub fn list_exo_catalog_audit(db: State<'_, Db>, limit: Option<i64>) -> AppResult<Vec<CatalogAuditEntry>> {
    db.with(|c| exogena::list_audit(c, limit.unwrap_or(200)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExoOverview {
    pub statuses: Vec<FormatStatusRow>,
    /// Registros por formato (también de formatos que aún no tienen fila de estado).
    pub record_counts: Vec<(String, i64)>,
    /// Huella actual de los socios y el capital de la empresa (ver `exogena::source_fingerprint`).
    pub source_fingerprint: String,
}

#[tauri::command]
pub fn get_exo_overview(db: State<'_, Db>, company_id: i64, year: i64) -> AppResult<ExoOverview> {
    db.with(|c| {
        Ok(ExoOverview {
            statuses: exogena::list_status(c, company_id, year)?,
            record_counts: exogena::record_counts(c, company_id, year)?,
            source_fingerprint: exogena::source_fingerprint(c, company_id)?,
        })
    })
}

#[tauri::command]
pub fn set_exo_format_status(db: State<'_, Db>, company_id: i64, year: i64, format_code: String, status: String, reason: Option<String>) -> AppResult<()> {
    db.with(|c| exogena::set_status(c, company_id, year, &format_code, &status, reason.as_deref().unwrap_or("")))
}

#[tauri::command]
pub fn list_exo_records(db: State<'_, Db>, company_id: i64, year: i64, format_code: String) -> AppResult<Vec<ExoRecord>> {
    db.with(|c| exogena::list_records(c, company_id, year, &format_code))
}

#[tauri::command]
pub fn apply_exo_sync(db: State<'_, Db>, input: ApplySyncInput) -> AppResult<SyncOutcome> {
    let input = input.validated()?;
    db.with(|c| exogena::apply_sync(c, &input))
}

#[tauri::command]
pub fn update_exo_record(db: State<'_, Db>, id: i64, patch: Value) -> AppResult<ExoRecord> {
    db.with(|c| exogena::update_record(c, id, &patch))
}

#[tauri::command]
pub fn create_exo_record(db: State<'_, Db>, company_id: i64, year: i64, format_code: String, data: Value) -> AppResult<ExoRecord> {
    if !(2000..=2100).contains(&year) || format_code.is_empty() || !format_code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::user("El formato o el año no son válidos."));
    }
    db.with(|c| exogena::create_manual_record(c, company_id, year, &format_code, &data))
}

#[tauri::command]
pub fn delete_exo_record(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| exogena::delete_record(c, id))
}

#[tauri::command]
pub fn list_exo_sync_runs(db: State<'_, Db>, company_id: i64, year: i64, limit: Option<i64>) -> AppResult<Vec<SyncRun>> {
    db.with(|c| exogena::list_sync_runs(c, company_id, year, limit.unwrap_or(20)))
}

/// Genera el .xlsx de Exógena (hojas de los formatos aplicables, con el logo de la empresa) y lo guarda donde elija el usuario.
#[tauri::command]
pub async fn save_exogena_workbook(
    app: AppHandle,
    db: State<'_, Db>,
    state: State<'_, AppState>,
    company_id: i64,
    workbook: exogena_xlsx::ExogenaWorkbook,
    suggested_name: String,
) -> AppResult<Option<String>> {
    let logo = db.with(|c| {
        let file: Option<String> = rusqlite::OptionalExtension::optional(c.query_row("SELECT logo_file FROM companies WHERE id = ?1", [company_id], |r| r.get::<_, Option<String>>(0)))?
            .ok_or_else(|| AppError::user("La empresa no existe o fue eliminada."))?;
        match file {
            Some(name) => logos::read_bytes(&state.paths.logos_dir, &name),
            None => Ok(None),
        }
    })?;
    let bytes = exogena_xlsx::build_workbook(&workbook, logo.as_deref())?;
    let Some(fp) = app
        .dialog()
        .file()
        .set_title("Exportar Información Exógena")
        .set_file_name(sanitize_with_extension(&suggested_name, "xlsx"))
        .add_filter("Excel", &["xlsx"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = to_path(fp)?;
    if path.extension().map_or(true, |e| !e.eq_ignore_ascii_case("xlsx")) {
        path.set_extension("xlsx");
    }
    std::fs::write(&path, &bytes).map_err(|e| {
        eprintln!("[exogena-xlsx] {e}");
        AppError::user("No se pudo guardar el archivo Excel en la ubicación elegida. Verifica los permisos de la carpeta.")
    })?;
    if let Ok(mut saved) = state.saved_files.lock() {
        saved.push(path.clone());
    }
    Ok(Some(path.to_string_lossy().to_string()))
}
