//! Extractos bancarios, planillas en PDF y reportes TXT (UIAF): Rust solo abre
//! el diálogo nativo y entrega los bytes del archivo. La lectura y el análisis
//! ocurren en el frontend, en el equipo; el archivo no se copia ni se guarda
//! en la base de datos.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::commands::to_path;
use crate::error::{AppError, AppResult};

const MAX_STATEMENT_BYTES: u64 = 50 * 1024 * 1024;
const MAX_REPORT_TXT_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub file_name: String,
    pub data_base64: String,
}

#[tauri::command]
pub async fn pick_statement_pdf(app: AppHandle, title: Option<String>) -> AppResult<Option<PickedFile>> {
    let Some(fp) = app
        .dialog()
        .file()
        .set_title(title.as_deref().unwrap_or("Seleccionar extracto PDF"))
        .add_filter("PDF", &["pdf"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = to_path(fp)?;
    if path.extension().map_or(true, |e| !e.eq_ignore_ascii_case("pdf")) {
        return Err(AppError::user("Solo se pueden importar archivos PDF."));
    }
    let size = std::fs::metadata(&path)?.len();
    if size > MAX_STATEMENT_BYTES {
        return Err(AppError::user("El archivo PDF es demasiado grande (máximo 50 MB)."));
    }
    let bytes = std::fs::read(&path)?;
    if !is_pdf(&bytes) {
        return Err(AppError::user("El archivo seleccionado no es un PDF válido."));
    }
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "documento.pdf".into());
    Ok(Some(PickedFile { file_name, data_base64: STANDARD.encode(bytes) }))
}

/// Reporte en texto plano (ej. UIAF). Se entregan los bytes tal cual: la
/// decodificación (UTF-8 o Windows-1252) la hace el frontend.
#[tauri::command]
pub async fn pick_report_txt(app: AppHandle, title: Option<String>) -> AppResult<Option<PickedFile>> {
    let Some(fp) = app
        .dialog()
        .file()
        .set_title(title.as_deref().unwrap_or("Seleccionar archivo TXT"))
        .add_filter("Texto", &["txt"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = to_path(fp)?;
    if path.extension().map_or(true, |e| !e.eq_ignore_ascii_case("txt")) {
        return Err(AppError::user("Solo se pueden importar archivos TXT."));
    }
    let size = std::fs::metadata(&path)?.len();
    if size > MAX_REPORT_TXT_BYTES {
        return Err(AppError::user("El archivo TXT es demasiado grande (máximo 200 MB)."));
    }
    let bytes = std::fs::read(&path)?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "reporte.txt".into());
    Ok(Some(PickedFile { file_name, data_base64: STANDARD.encode(bytes) }))
}

/// La firma %PDF- debe estar en el primer kilobyte (la especificación tolera bytes previos).
pub(crate) fn is_pdf(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(1024)].windows(5).any(|w| w == b"%PDF-")
}

#[cfg(test)]
mod tests {
    use super::is_pdf;

    #[test]
    fn detects_pdf_signature() {
        assert!(is_pdf(b"%PDF-1.7\n..."));
        assert!(is_pdf(b"\xEF\xBB\xBF%PDF-1.4"));
        assert!(!is_pdf(b"PK\x03\x04"));
        assert!(!is_pdf(b""));
    }
}
