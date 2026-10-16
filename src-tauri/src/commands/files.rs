use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::to_path;
use crate::error::{AppError, AppResult};
use crate::services::excel::{self, Workbook};
use crate::services::xlsx_export::{self, ExportSheet};
use crate::state::AppState;

const MAX_PDF_BYTES: usize = 20 * 1024 * 1024;

/// Excel (.xlsx / .xls) o TXT en un mismo diálogo (p. ej. el Reporte de
/// operaciones, que la entidad entrega en ambos formatos). El Excel se lee aquí;
/// el TXT se entrega tal cual y se interpreta en el frontend.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PickedExcelOrText {
    #[serde(rename_all = "camelCase")]
    Excel { workbook: Workbook },
    #[serde(rename_all = "camelCase")]
    Text { file_name: String, data_base64: String },
}

const MAX_TEXT_BYTES: u64 = 50 * 1024 * 1024;

#[tauri::command]
pub async fn pick_excel_or_txt(app: AppHandle, title: Option<String>) -> AppResult<Option<PickedExcelOrText>> {
    let Some(fp) = app
        .dialog()
        .file()
        .set_title(title.as_deref().unwrap_or("Importar archivo"))
        .add_filter("Excel o TXT", &["xlsx", "xls", "txt"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = to_path(fp)?;
    if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("txt")) {
        if std::fs::metadata(&path)?.len() > MAX_TEXT_BYTES {
            return Err(AppError::user("El archivo TXT supera el tamaño máximo de 50 MB."));
        }
        let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "reporte.txt".into());
        return Ok(Some(PickedExcelOrText::Text { file_name, data_base64: STANDARD.encode(std::fs::read(&path)?) }));
    }
    Ok(Some(PickedExcelOrText::Excel { workbook: excel::read_workbook(&path)? }))
}

#[tauri::command]
pub async fn pick_excel_file(app: AppHandle) -> AppResult<Option<Workbook>> {
    let Some(fp) = app
        .dialog()
        .file()
        .set_title("Importar archivo Excel")
        .add_filter("Excel", &["xlsx", "xls"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    excel::read_workbook(&to_path(fp)?).map(Some)
}

/// Archivo soltado sobre la ventana (la ruta la entrega macOS al arrastrar).
#[tauri::command]
pub async fn load_dropped_excel(path: String) -> AppResult<Workbook> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || !excel::is_excel_path(&path) {
        return Err(AppError::user("Solo se pueden importar archivos Excel (.xlsx o .xls)."));
    }
    excel::read_workbook(&path)
}

/// Solo letras, números, guion y guion bajo; siempre termina en .pdf.
pub fn sanitize_file_name(name: &str) -> String {
    let stem = name.trim().trim_end_matches(".pdf").trim_end_matches(".PDF");
    let mut out: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    let out = out.trim_matches('_');
    let out = if out.is_empty() { "documento" } else { out };
    format!("{}.pdf", out.chars().take(150).collect::<String>())
}

#[tauri::command]
pub async fn save_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    data_base64: String,
    suggested_name: String,
) -> AppResult<Option<String>> {
    let bytes = STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|_| AppError::user("No se pudo generar el PDF."))?;
    if bytes.len() > MAX_PDF_BYTES || !bytes.starts_with(b"%PDF-") {
        return Err(AppError::user("No se pudo generar el PDF."));
    }
    let Some(fp) = app
        .dialog()
        .file()
        .set_title("Guardar certificado")
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
        eprintln!("[pdf] {e}");
        AppError::user("No se pudo guardar el PDF en la ubicación elegida. Verifica los permisos de la carpeta.")
    })?;
    if let Ok(mut saved) = state.saved_files.lock() {
        saved.push(path.clone());
    }
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Nombre sugerido seguro con la extensión indicada (reutiliza la limpieza de PDF).
pub(crate) fn sanitize_with_extension(name: &str, ext: &str) -> String {
    let stem = name.trim().trim_end_matches(&format!(".{ext}")).trim_end_matches(&format!(".{}", ext.to_uppercase()));
    let pdf = sanitize_file_name(stem);
    format!("{}.{ext}", pdf.trim_end_matches(".pdf"))
}

/// Genera un .xlsx con las hojas indicadas y lo guarda donde elija el usuario.
#[tauri::command]
pub async fn save_excel(
    app: AppHandle,
    state: State<'_, AppState>,
    sheets: Vec<ExportSheet>,
    suggested_name: String,
) -> AppResult<Option<String>> {
    let bytes = xlsx_export::build_workbook(&sheets)?;
    let Some(fp) = app
        .dialog()
        .file()
        .set_title("Exportar a Excel")
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
        eprintln!("[xlsx] {e}");
        AppError::user("No se pudo guardar el archivo Excel en la ubicación elegida. Verifica los permisos de la carpeta.")
    })?;
    if let Ok(mut saved) = state.saved_files.lock() {
        saved.push(path.clone());
    }
    Ok(Some(path.to_string_lossy().to_string()))
}

fn ensure_saved(state: &AppState, path: &Path) -> AppResult<()> {
    let allowed = state
        .saved_files
        .lock()
        .map(|s| s.iter().any(|p| p == path))
        .unwrap_or(false);
    if allowed {
        Ok(())
    } else {
        Err(AppError::user("Ese archivo no fue generado en esta sesión."))
    }
}

/// Abre un archivo generado en esta sesión (o lo muestra en Finder).
#[tauri::command]
pub fn open_saved_file(state: State<'_, AppState>, path: String, reveal: bool) -> AppResult<()> {
    let path = PathBuf::from(path);
    ensure_saved(&state, &path)?;
    let mut cmd = std::process::Command::new("open");
    if reveal {
        cmd.arg("-R");
    }
    cmd.arg(&path)
        .spawn()
        .map_err(|_| AppError::user("No se pudo abrir el archivo."))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{sanitize_file_name, sanitize_with_extension};

    #[test]
    fn sanitizes_names() {
        assert_eq!(
            sanitize_file_name("Certificado_ICA_MONO COLOMBIA S.A.S._2026.pdf"),
            "Certificado_ICA_MONO_COLOMBIA_S_A_S_2026.pdf"
        );
        assert_eq!(sanitize_file_name("../../etc/passwd"), "etc_passwd.pdf");
        assert_eq!(sanitize_file_name("///"), "documento.pdf");
    }

    #[test]
    fn sanitizes_excel_names() {
        assert_eq!(sanitize_with_extension("Análisis Extracto 01 2026.pdf", "xlsx"), "An_lisis_Extracto_01_2026.xlsx");
        assert_eq!(sanitize_with_extension("Resumen.xlsx", "xlsx"), "Resumen.xlsx");
    }
}
