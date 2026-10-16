use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::to_path;
use crate::database::{companies, company_documents, Db};
use crate::error::AppResult;
use crate::models::company::{Company, CompanyInput};
use crate::services::{company_documents as storage, logos};
use crate::state::AppState;

fn check_logo(state: &AppState, input: &CompanyInput) -> AppResult<()> {
    if let Some(name) = &input.logo_file {
        let path = logos::path_for(&state.paths.logos_dir, name)?;
        if !path.exists() {
            return Err(crate::error::AppError::user("No se encontró el logo seleccionado. Vuelve a cargarlo."));
        }
    }
    Ok(())
}

/// Cada versión nueva debe existir ya en el almacenamiento de la app (la cargó `pick_company_document`).
fn check_new_documents(state: &AppState, input: &CompanyInput) -> AppResult<Vec<u64>> {
    input
        .new_documents
        .iter()
        .map(|d| {
            let path = storage::path_for(&state.paths.company_documents_dir, &d.stored_file)?;
            std::fs::metadata(&path)
                .map(|m| m.len())
                .map_err(|_| crate::error::AppError::user(format!("No se encontró el archivo de «{}». Vuelve a cargarlo.", d.file_name)))
        })
        .collect()
}

fn register_documents(c: &rusqlite::Connection, company_id: i64, input: &CompanyInput, sizes: &[u64]) -> AppResult<()> {
    for (doc, size) in input.new_documents.iter().zip(sizes) {
        company_documents::insert(c, company_id, doc, *size as i64, None)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_companies(db: State<'_, Db>, search: Option<String>) -> AppResult<Vec<Company>> {
    db.with(|c| companies::list(c, search.as_deref()))
}

#[tauri::command]
pub fn create_company(db: State<'_, Db>, state: State<'_, AppState>, input: CompanyInput) -> AppResult<Company> {
    let input = input.validated()?;
    check_logo(&state, &input)?;
    let sizes = check_new_documents(&state, &input)?;
    db.with(|c| {
        let tx = c.transaction()?;
        let id = companies::insert(&tx, &input)?;
        register_documents(&tx, id, &input, &sizes)?;
        tx.commit()?;
        companies::get(c, id)
    })
}

#[tauri::command]
pub fn update_company(db: State<'_, Db>, state: State<'_, AppState>, id: i64, input: CompanyInput) -> AppResult<Company> {
    let input = input.validated()?;
    check_logo(&state, &input)?;
    let sizes = check_new_documents(&state, &input)?;
    db.with(|c| {
        let before = companies::get(c, id)?;
        let tx = c.transaction()?;
        companies::update(&tx, id, &input)?;
        register_documents(&tx, id, &input, &sizes)?;
        tx.commit()?;
        if let Some(old) = before.logo_file.filter(|old| Some(old) != input.logo_file.as_ref()) {
            logos::remove(&state.paths.logos_dir, &old);
        }
        companies::get(c, id)
    })
}

#[tauri::command]
pub fn delete_company(db: State<'_, Db>, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    db.with(|c| {
        let company = companies::get(c, id)?;
        companies::delete(c, id)?;
        for d in &company.documents {
            storage::remove(&state.paths.company_documents_dir, &d.stored_file);
        }
        if let Some(logo) = company.logo_file {
            logos::remove(&state.paths.logos_dir, &logo);
        }
        Ok(())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogoUpload {
    pub logo_file: String,
    pub data_url: String,
}

/// Abre el diálogo nativo, copia la imagen al directorio de logos y devuelve su referencia.
#[tauri::command]
pub async fn pick_company_logo(app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<LogoUpload>> {
    let Some(fp) = app
        .dialog()
        .file()
        .set_title("Seleccionar logo")
        .add_filter("Imagen", &["png", "jpg", "jpeg"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let name = logos::import_from_path(&state.paths.logos_dir, &to_path(fp)?)?;
    let data_url = logos::read_data_url(&state.paths.logos_dir, &name)?.unwrap_or_default();
    Ok(Some(LogoUpload { logo_file: name, data_url }))
}

#[tauri::command]
pub fn get_logo_data_url(state: State<'_, AppState>, logo_file: String) -> AppResult<Option<String>> {
    logos::read_data_url(&state.paths.logos_dir, &logo_file)
}
