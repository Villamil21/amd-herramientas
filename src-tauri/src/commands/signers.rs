use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::to_path;
use crate::database::{signers, Db};
use crate::error::AppResult;
use crate::models::signer::{CertificateSigner, CertificateSignerInput};
use crate::services::signatures;
use crate::state::AppState;

fn with_status(state: &AppState, mut s: CertificateSigner) -> CertificateSigner {
    s.signature_available = signatures::is_available(&state.paths.signatures_dir, &s.signature_file);
    s
}

#[tauri::command]
pub fn list_certificate_signers(db: State<'_, Db>, state: State<'_, AppState>, search: Option<String>) -> AppResult<Vec<CertificateSigner>> {
    let list = db.with(|c| signers::list(c, search.as_deref()))?;
    Ok(list.into_iter().map(|s| with_status(&state, s)).collect())
}

/// Registra la referencia solo si el PNG ya está copiado en el almacenamiento de firmas.
#[tauri::command]
pub fn create_certificate_signer(db: State<'_, Db>, state: State<'_, AppState>, input: CertificateSignerInput) -> AppResult<CertificateSigner> {
    let v = input.validated()?;
    signatures::ensure_exists(&state.paths.signatures_dir, &v.signature_file)?;
    let s = db.with(|c| {
        let id = signers::insert(c, &v)?;
        signers::get(c, id)
    })?;
    Ok(with_status(&state, s))
}

/// La firma anterior se elimina únicamente después de actualizar SQLite con éxito.
#[tauri::command]
pub fn update_certificate_signer(db: State<'_, Db>, state: State<'_, AppState>, id: i64, input: CertificateSignerInput) -> AppResult<CertificateSigner> {
    let v = input.validated()?;
    signatures::ensure_exists(&state.paths.signatures_dir, &v.signature_file)?;
    let s = db.with(|c| {
        let old = signers::get(c, id)?;
        signers::update(c, id, &v)?;
        if old.signature_file != v.signature_file {
            signatures::remove(&state.paths.signatures_dir, &old.signature_file);
        }
        signers::get(c, id)
    })?;
    Ok(with_status(&state, s))
}

#[tauri::command]
pub fn delete_certificate_signer(db: State<'_, Db>, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    db.with(|c| {
        let s = signers::delete(c, id)?;
        signatures::remove(&state.paths.signatures_dir, &s.signature_file);
        Ok(())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureUpload {
    pub signature_file: String,
    pub data_url: String,
}

/// Valida el PNG y guarda una copia propia. SQLite no cambia hasta que el usuario guarde.
#[tauri::command]
pub async fn pick_certificate_signature(app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<SignatureUpload>> {
    let Some(file) = app.dialog().file().set_title("Seleccionar firma PNG").add_filter("PNG", &["png"]).blocking_pick_file() else {
        return Ok(None);
    };
    let dir = &state.paths.signatures_dir;
    let name = signatures::import_from_path(dir, &to_path(file)?)?;
    let data_url = signatures::read_data_url(dir, &name).unwrap_or_default();
    Ok(Some(SignatureUpload { signature_file: name, data_url }))
}

/// `None` si el archivo no existe o ya no es un PNG válido.
#[tauri::command]
pub fn get_signature_data_url(state: State<'_, AppState>, signature_file: String) -> Option<String> {
    signatures::read_data_url(&state.paths.signatures_dir, &signature_file)
}
