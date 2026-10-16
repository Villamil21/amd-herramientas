use tauri::{AppHandle, State};

use crate::database::Db;
use crate::error::AppResult;
use crate::services::reset::{self, ResetOutcome};
use crate::state::AppState;

/// «Zona de peligro»: vacía todos los datos de la aplicación (ver `services::reset`). Solo se ejecuta cuando el
/// usuario escribió la frase exacta y confirmó por segunda vez; nunca se invoca sola.
#[tauri::command]
pub fn reset_app_data(app: AppHandle, db: State<'_, Db>, state: State<'_, AppState>, phrase: String, final_confirmation: bool) -> AppResult<ResetOutcome> {
    let version = app.package_info().version.to_string();
    let outcome = db.with(|c| reset::reset_data(c, &state.paths, &version, &phrase, final_confirmation))?;
    // Estado en memoria que apuntaba a datos que ya no existen.
    if let Ok(mut pending) = state.pending_backup.lock() {
        *pending = None;
    }
    if let Ok(mut saved) = state.saved_files.lock() {
        saved.clear();
    }
    if let Ok(mut folder) = state.invoice_folder.lock() {
        *folder = None;
    }
    Ok(outcome)
}
