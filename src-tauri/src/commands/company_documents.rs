use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::files::sanitize_file_name;
use crate::commands::to_path;
use crate::database::{company_documents, Db};
use crate::error::{AppError, AppResult};
use crate::models::company::DOCUMENT_KINDS;
use crate::services::company_documents as storage;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedDocument {
    pub stored_file: String,
    pub file_name: String,
    pub size_bytes: u64,
    /// El PDF para leerlo localmente (extracción de datos y vista previa).
    pub data_base64: String,
}

/// Abre el diálogo nativo, copia el PDF al almacenamiento de la app y lo devuelve para leerlo en el equipo.
/// No se registra en la empresa hasta que el formulario se guarda.
#[tauri::command]
pub async fn pick_company_document(app: AppHandle, state: State<'_, AppState>, kind: String) -> AppResult<Option<PickedDocument>> {
    if !DOCUMENT_KINDS.contains(&kind.as_str()) {
        return Err(AppError::user("El tipo de documento debe ser RUT o Cámara de Comercio."));
    }
    let title = if kind == "rut" { "Seleccionar RUT (PDF)" } else { "Seleccionar Cámara de Comercio (PDF)" };
    let Some(fp) = app.dialog().file().set_title(title).add_filter("PDF", &["pdf"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = to_path(fp)?;
    let (stored_file, bytes) = storage::import_from_path(&state.paths.company_documents_dir, &path)?;
    let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "documento.pdf".into());
    Ok(Some(PickedDocument { stored_file, file_name, size_bytes: bytes.len() as u64, data_base64: STANDARD.encode(&bytes) }))
}

/// Descarta un PDF cargado en el formulario que nunca se guardó. Una versión ya registrada nunca se borra.
#[tauri::command]
pub fn discard_company_document(db: State<'_, Db>, state: State<'_, AppState>, stored_file: String) -> AppResult<()> {
    db.with(|c| {
        if !company_documents::is_referenced(c, &stored_file)? {
            storage::remove(&state.paths.company_documents_dir, &stored_file);
        }
        Ok(())
    })
}

/// El PDF de una versión (registrada o recién cargada) en base64, para la vista previa.
#[tauri::command]
pub fn read_company_document(state: State<'_, AppState>, stored_file: String) -> AppResult<String> {
    Ok(STANDARD.encode(storage::read(&state.paths.company_documents_dir, &stored_file)?))
}

/// Guarda una copia de cualquier versión en la ubicación que elija el usuario.
#[tauri::command]
pub async fn download_company_document(app: AppHandle, state: State<'_, AppState>, stored_file: String, suggested_name: String) -> AppResult<Option<String>> {
    let bytes = storage::read(&state.paths.company_documents_dir, &stored_file)?;
    let Some(fp) = app
        .dialog()
        .file()
        .set_title("Guardar documento")
        .set_file_name(sanitize_file_name(&suggested_name))
        .add_filter("PDF", &["pdf"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = to_path(fp)?;
    if path.extension().map_or(true, |e| !e.eq_ignore_ascii_case("pdf")) {
        path.set_extension("pdf");
    }
    std::fs::write(&path, &bytes).map_err(|e| {
        eprintln!("[company-documents] {e}");
        AppError::user("No se pudo guardar el PDF en la ubicación elegida. Verifica los permisos de la carpeta.")
    })?;
    if let Ok(mut saved) = state.saved_files.lock() {
        saved.push(path.clone());
    }
    Ok(Some(path.to_string_lossy().to_string()))
}
