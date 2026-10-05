//! Análisis de IVA de facturas: Rust abre el selector nativo de carpetas,
//! lista los PDF y entrega los bytes de cada uno. Los archivos solo se leen:
//! nunca se modifican, renombran, mueven ni copian. La lectura del PDF y los
//! cálculos ocurren en el frontend, en el equipo.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::statements::is_pdf;
use crate::commands::to_path;
use crate::database::{vat_titles, Db};
use crate::error::{AppError, AppResult};
use crate::models::withholding::{validate_title_category, DocumentTitleMapping, DocumentTitleMappingInput};
use crate::state::AppState;

const MAX_INVOICE_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceFile {
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceFolder {
    pub folder_name: String,
    pub files: Vec<InvoiceFile>,
}

/// PDF de la carpeta (sin subcarpetas), ordenados por nombre. Se omiten los
/// ocultos, incluidos los «._archivo.pdf» que macOS crea en discos externos.
fn list_pdfs(dir: &Path) -> AppResult<Vec<InvoiceFile>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if name.starts_with('.') || !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
            continue;
        }
        let meta = entry.metadata()?;
        if meta.is_file() {
            files.push(InvoiceFile { name, size: meta.len() });
        }
    }
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(files)
}

#[tauri::command]
pub async fn pick_invoice_folder(app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<InvoiceFolder>> {
    let Some(fp) = app.dialog().file().set_title("Seleccionar carpeta de facturas").blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = to_path(fp)?;
    let files = list_pdfs(&dir).map_err(|_| AppError::user("No se pudo leer la carpeta seleccionada. Verifica los permisos."))?;
    let folder_name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| dir.to_string_lossy().to_string());
    *state.invoice_folder.lock().map_err(|_| AppError::user("Inténtalo de nuevo."))? = Some(dir);
    Ok(Some(InvoiceFolder { folder_name, files }))
}

/// Solo un nombre de archivo de la carpeta seleccionada: sin rutas ni «..».
fn resolve_in_folder(folder: &Path, file_name: &str) -> AppResult<PathBuf> {
    let valid = !file_name.is_empty()
        && !file_name.contains('/')
        && !file_name.contains('\\')
        && file_name != "."
        && file_name != ".."
        && Path::new(file_name).extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if !valid {
        return Err(AppError::user("Archivo no válido."));
    }
    Ok(folder.join(file_name))
}

/// Bytes de un PDF de la carpeta seleccionada (respuesta binaria, sin base64).
#[tauri::command]
pub fn read_invoice_pdf(state: State<'_, AppState>, file_name: String) -> AppResult<Response> {
    let folder = state
        .invoice_folder
        .lock()
        .map_err(|_| AppError::user("Inténtalo de nuevo."))?
        .clone()
        .ok_or_else(|| AppError::user("Primero selecciona la carpeta de facturas."))?;
    let path = resolve_in_folder(&folder, &file_name)?;
    let meta = std::fs::metadata(&path).map_err(|_| AppError::user("El archivo ya no está en la carpeta."))?;
    if meta.len() > MAX_INVOICE_BYTES {
        return Err(AppError::user("El PDF es demasiado grande (máximo 50 MB)."));
    }
    let bytes = std::fs::read(&path).map_err(|_| AppError::user("No se pudo leer el archivo."))?;
    if !is_pdf(&bytes) {
        return Err(AppError::user("El archivo no es un PDF válido."));
    }
    Ok(Response::new(bytes))
}

// Clasificación persistente de títulos de documento (Factura electrónica / Nota crédito).

#[tauri::command]
pub fn list_vat_document_titles(db: State<'_, Db>) -> AppResult<Vec<DocumentTitleMapping>> {
    db.with(|c| vat_titles::list(c))
}

#[tauri::command]
pub fn save_vat_document_titles(db: State<'_, Db>, items: Vec<DocumentTitleMappingInput>) -> AppResult<()> {
    let items = items.into_iter().map(DocumentTitleMappingInput::validated).collect::<AppResult<Vec<_>>>()?;
    db.with(|c| vat_titles::save(c, &items))
}

#[tauri::command]
pub fn update_vat_document_title(db: State<'_, Db>, id: i64, category: String) -> AppResult<()> {
    let category = validate_title_category(&category)?;
    db.with(|c| vat_titles::update_category(c, id, &category))
}

#[tauri::command]
pub fn delete_vat_document_title(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| vat_titles::delete(c, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_outside_folder() {
        let dir = Path::new("/tmp/facturas");
        assert!(resolve_in_folder(dir, "../secreto.pdf").is_err());
        assert!(resolve_in_folder(dir, "sub/a.pdf").is_err());
        assert!(resolve_in_folder(dir, "a.txt").is_err());
        assert_eq!(resolve_in_folder(dir, "A (1).PDF").unwrap(), dir.join("A (1).PDF"));
    }

    #[test]
    fn lists_only_visible_pdfs_without_subfolders() {
        let dir = std::env::temp_dir().join(format!("amd-invoices-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub.pdf")).unwrap();
        for name in ["b.pdf", "A.PDF", "._b.pdf", "nota.txt"] {
            std::fs::write(dir.join(name), b"%PDF-1.4").unwrap();
        }
        std::fs::write(dir.join("sub.pdf").join("c.pdf"), b"%PDF-1.4").unwrap();
        let names: Vec<_> = list_pdfs(&dir).unwrap().into_iter().map(|f| f.name).collect();
        assert_eq!(names, ["A.PDF", "b.pdf"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
