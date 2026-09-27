use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::to_path;
use crate::database::{companies, Db};
use crate::error::AppResult;
use crate::models::company::{Company, CompanyInput};
use crate::services::logos;
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

#[tauri::command]
pub fn list_companies(db: State<'_, Db>, search: Option<String>) -> AppResult<Vec<Company>> {
    db.with(|c| companies::list(c, search.as_deref()))
}

#[tauri::command]
pub fn create_company(db: State<'_, Db>, state: State<'_, AppState>, input: CompanyInput) -> AppResult<Company> {
    let input = input.validated()?;
    check_logo(&state, &input)?;
    db.with(|c| {
        let id = companies::insert(c, &input)?;
        companies::get(c, id)
    })
}

#[tauri::command]
pub fn update_company(db: State<'_, Db>, state: State<'_, AppState>, id: i64, input: CompanyInput) -> AppResult<Company> {
    let input = input.validated()?;
    check_logo(&state, &input)?;
    db.with(|c| {
        let before = companies::get(c, id)?;
        companies::update(c, id, &input)?;
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
